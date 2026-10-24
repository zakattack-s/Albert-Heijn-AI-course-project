import logging
from typing import AsyncGenerator
from databricks.sdk import WorkspaceClient
import mlflow
from agents import (
    Agent,
    Runner,
    function_tool,
    set_default_openai_api,
    set_default_openai_client,
)
from agents.tracing import set_trace_processors
import os
from openai import AsyncOpenAI
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.history import normalize_history_items
from agent_server.utils import (
    get_session_id,
    process_agent_stream_events,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# OpenAI setup
# ---------------------------------------------------------------------------

set_default_openai_client(
    AsyncOpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
    )
)

set_default_openai_api("chat_completions")

set_trace_processors([])

mlflow.openai.autolog()

logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)


# ---------------------------------------------------------------------------
# Albert Heijn Assistant Instructions
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are an expert Data AI Assistant for Albert Heijn.

Your primary role is to understand natural language business questions, convert them into accurate Spark SQL queries based on the Gold Layer Delta tables, execute the queries using the execute_sql tool, and return the results to the user in clear, concise natural language.

SQL queries and raw query results are internal and should not be included in the final answer unless the user explicitly asks to see them.
EXECUTION RULES:

- When the user asks a question that requires data, generate the appropriate Spark SQL query and use the execute_sql tool to run it.
- After the tool returns the results, give the user a clear and concise answer based on those results.
- Do not ask the user to execute the SQL themselves.
- Always use the full table path:
  `spikeup_ah_capstone.default.<table_name>`.
- Use appropriate SQL aggregations such as SUM, AVG, COUNT, GROUP BY, ORDER BY, and LIMIT.
- Trust the schema and the data types that we provided, don't make unnecessary SQL queries.

Database Schema Namespace: `spikeup_ah_capstone.default`

Tables & Columns Description:

1. `spikeup_ah_capstone.default.gold_product_characteristics`
   - `ProductID` (int): Unique product identifier
   - `short_item_description` (string): Product item description
   - `weight_in_kg` (double): Product weight in kilograms
   - `weight_missing` (boolean): Data quality flag (True if weight was missing in source)
   - `length_in_mm`, `width_in_mm`, `height_in_mm` (int/double/string): Dimensions of the product
   - `delivery_unit_id`, `delivery_size` (int): Packaging and delivery specifications

2. `spikeup_ah_capstone.default.gold_product_sales`
   - `ProductID` (int): Unique product identifier
   - `total_sales` (double): Aggregate sales amount across 52 weeks (How many units sold not revenue in currency)
   - `avg_weekly_sales` (double): Average weekly sales amount (How many units sold not revenue in currency)
   - `num_of_promotional_weeks` (int): Number of weeks the product was on promotion
   - `avg_promotional_sales` (double/string): Average sales during promotional weeks (How many units sold not revenue in currency)
   - `avg_non_promotional_sales` (double/string): Average sales during regular weeks (How many units sold not revenue in currency)
   - `Category` (string): Product category
   - `Group` (string): Product group
   - `sales_missing` (boolean): Data quality flag indicating missing sales data

3. `spikeup_ah_capstone.default.gold_weekly_sales`
   - `ProductID` (int): Unique product identifier
   - `week` (int): Week index (1 to 52)
   - `sales` (double): Weekly sales amount (How many units sold not revenue in currency)
   - `Promoted` (boolean): Flag indicating whether the item was on promotion in that week
   - `sales_missing`, `promotion_week_missing`, `group_missing` (boolean): Quality indicator flags



SCHEMA CASTING RULE:

Numeric metrics such as:
- `weight_in_kg`
- `avg_promotional_sales`
- `avg_non_promotional_sales`
- `total_sales`
- `length_in_mm`
- `width_in_mm`
- `height_in_mm`

may contain string 'null' or NaN values.

Always use:

`TRY_CAST(<column> AS DOUBLE)`

when performing mathematical calculations, filtering, or sorting on numeric fields.

FILTERING RULE:

Always exclude NULL values resulting from TRY_CAST using:

`TRY_CAST(<column> AS DOUBLE) IS NOT NULL`.
"""


# ---------------------------------------------------------------------------
# Databricks SQL Warehouse
# ---------------------------------------------------------------------------

workspace_client = WorkspaceClient()


@function_tool
def execute_sql(sql: str) -> str:
    warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID")

    if not warehouse_id:
        return "ERROR: DATABRICKS_WAREHOUSE_ID is not set."

    try:
        response = workspace_client.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=sql,
            wait_timeout="50s",
        )

        if response.status.state.value != "SUCCEEDED":
            return (
                f"SQL query failed.\n\n"
                f"Status: {response.status.state.value}\n"
                f"Error: {response.status.error}"
            )

        columns = [
            column.name
            for column in response.manifest.schema.columns
        ]

        rows = response.result.data_array

        output = "SQL query result:\n\n"

        output += " | ".join(columns) + "\n"
        output += " | ".join(["---"] * len(columns)) + "\n"

        for row in rows:
            output += " | ".join(str(value) for value in row) + "\n"

        return output

    except Exception as e:
        return (
            f"SQL execution failed:\n\n"
            f"{type(e).__name__}: {e}"
        )


# ---------------------------------------------------------------------------
# Create the Albert Heijn Agent
# ---------------------------------------------------------------------------

def create_agent() -> Agent:
    return Agent(
        name="Albert Heijn Data Assistant",
        instructions=SYSTEM_PROMPT,
        model="gpt-4o-mini",
        tools=[execute_sql],
    )


# ---------------------------------------------------------------------------
# Non-streaming request
# ---------------------------------------------------------------------------

@invoke()
async def invoke_handler(
    request: ResponsesAgentRequest,
) -> ResponsesAgentResponse:

    if session_id := get_session_id(request):
        mlflow.update_current_trace(
            metadata={"mlflow.trace.session": session_id}
        )

    agent = create_agent()

    messages = normalize_history_items(
        [item.model_dump() for item in request.input]
    )

    result = await Runner.run(agent, messages)

    return ResponsesAgentResponse(
        output=[
            item.to_input_item()
            for item in result.new_items
        ]
    )


# ---------------------------------------------------------------------------
# Streaming request
# ---------------------------------------------------------------------------

@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:

    if session_id := get_session_id(request):
        mlflow.update_current_trace(
            metadata={"mlflow.trace.session": session_id}
        )

    agent = create_agent()

    messages = normalize_history_items(
        [item.model_dump() for item in request.input]
    )

    result = Runner.run_streamed(
        agent,
        input=messages,
    )

    async for event in process_agent_stream_events(
        result.stream_events()
    ):
        yield event