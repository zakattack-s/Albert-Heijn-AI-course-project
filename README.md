# Albert Heijn AI Data Assistant

An AI assistant that answers stakeholders' questions about product and sales data in plain language. Built in Databricks as a course project for the **SpikeUp AI** course.

> **Disclaimer:** This is an educational project and is not affiliated with Albert Heijn. The data was provided by Albert Heijn for the course and is private. No real data is included in this repository.

https://github.com/user-attachments/assets/81360687-c191-4e8b-a5ac-4bb1521e3617

## The Assignment

Build an AI assistant in Databricks that allows Albert Heijn stakeholders to ask questions about their data and receive reliable answers without having to write SQL.

## What It Does

1. The user asks a question in natural language, in Dutch or English.
2. The AI agent interprets the question and generates a Spark SQL query.
3. The query is executed against the Gold tables through a Databricks SQL warehouse.
4. The agent uses the query results to generate a natural-language answer.
5. When the user requests a visualization, the agent returns structured chart data as JSON, which the frontend renders as a chart.

### Architecture

<img width="682" height="527" alt="image" src="https://github.com/user-attachments/assets/9a106d14-386e-486a-9f06-fdad1416ca6a" />


## Data Engineering: Medallion Architecture

We received sample data from Albert Heijn and processed it using **Apache Spark in Databricks**, following the Bronze, Silver, and Gold medallion architecture.

### Data Quality Checks

During data exploration and transformation, we checked:

- Row counts and unexpected changes between transformation stages.
- Column names and data types.
- Duplicate product records.
- Null values and placeholder values representing missing data.
- Joinability between tables.
- Negative, zero, and other suspicious numeric values.
- Spelling and consistency across text columns.

These checks helped us identify data quality issues and prepare the data for reliable querying.

### Bronze Layer

Raw data was loaded into the Bronze layer with two additional metadata columns: the ingestion timestamp and the source table.

The sample data was already prepared, so these columns were not essential for the transformations themselves. We added them to reflect a more realistic data engineering pipeline.

### Silver Layer

Each source table was cleaned and transformed separately.

| Table | Transformations |
|---|---|
| **Products** | Corrected the data type of the weight column and converted placeholder values into proper nulls. |
| **Product groups** | Standardized missing group values by converting them into nulls. |
| **Promotions** | Split promotion weeks into separate rows, with one row per product per promotion week. Converted non-numeric symbols into nulls and added a flag to identify missing values. |
| **Sales** | Converted the data into long format, with one row per product per week. Converted missing values into nulls, treated zero sales values as invalid based on guidance from our project supervisor, and added a flag to identify missing or invalid sales data. |

The decision to treat zero sales values as invalid was based on guidance from our supervisor about the quality of the supplied data. These values were converted to nulls rather than interpreted as genuine zero-unit sales.

### Gold Layer

We designed the Gold tables around the business questions the assistant needed to answer. The aim was to make the data easier to query and reduce the complexity of the SQL the agent needed to generate.

This resulted in three tables:

| Table | Purpose |
|---|---|
| **Product characteristics** (`gold_product_characteristics`) | Combines product and delivery-unit attributes into one table, including product descriptions, dimensions, weights, expiry information, and delivery-unit details. |
| **Weekly sales** (`gold_weekly_sales`) | Contains weekly sales enriched with product categories, groups, and promotion information, supporting week-level sales and promotion analysis. |
| **Aggregated sales** (`gold_product_sales`) | Contains one row per product with total, average, minimum, maximum, and standard deviation of sales, along with promotional versus non-promotional sales averages and the number of promotional weeks. |

**Missing-value flags** were retained in the Gold tables wherever relevant, including sales, product weight, group information, and promotion information. These flags allow the agent to account for known data gaps and communicate relevant limitations when presenting results.

## The Application

The application is based on the **Databricks OpenAI Agents SDK chatbot template**. We adapted the template to connect the AI agent to our Gold tables and provide a conversational interface for business questions.

### Project Files

| File or folder | Purpose |
|---|---|
| [`agent_server/agent.py`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/blob/main/Albert%20Heijn%20AI%20assistant/agent_server/agent.py) | Contains the agent setup, system prompt, SQL execution tool, and request handlers. We defined the assistant's scope, SQL rules, data quality instructions, and chart output format. |
| [`e2e-chatbot-app-next/`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/tree/main/Albert%20Heijn%20AI%20assistant/e2e-chatbot-app-next) | Contains the custom chat frontend and chart-rendering functionality, built by Hanin Maalla with AI assistance. |
| [`app.yaml`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/blob/main/Albert%20Heijn%20AI%20assistant/app.yaml) | Configures the Databricks application and references the required resources and environment settings. API keys and other secrets are not hardcoded in the source code. |

The remaining files are part of the original Databricks template unless otherwise documented.

## Key Design Choices

- **Read-only database access:** The agent uses a service principal with read-only permissions to query the Gold tables.
- **SQL-grounded answers:** Responses are based on SQL queries executed against the connected Databricks warehouse, rather than relying solely on the language model's knowledge.
- **Defined data scope:** The assistant is connected to a specific set of Albert Heijn Gold tables, keeping its analysis focused on the data available for the project.
- **Data-quality awareness:** Missing and invalid values are tracked through quality flags in the data pipeline, allowing the agent to account for data limitations when interpreting results.
- **Separation of responsibilities:** The backend handles agent logic and SQL execution, while the Next.js frontend manages the chat interface and renders structured chart outputs.
- **Structured chart generation:** The agent returns chart specifications in a predefined JSON format, which the frontend uses to render visualizations.

## System Prompt Guardrails

The system prompt defines how the agent should interpret questions, handle uncertainty, and communicate results.

- **Stay within scope:** Answer questions supported by the connected Albert Heijn database. Politely decline unrelated questions and ask for clarification when product references or metrics are ambiguous.
- **Preserve meaning and language:** Respond in the user's language and preserve product names, categories, and IDs exactly as stored in the database.
- **Handle failures transparently:** If a SQL query fails, retry once without changing the meaning of the original question. If the retry also fails, report the failure rather than inventing a result.
- **Represent data accurately:** Keep missing values distinct from zero, respect data-quality flags, and explain when incomplete or invalid records affect the results.
- **Follow output rules:** Present results in consistent formats, generate charts only from retrieved data, and follow the required JSON structure for frontend rendering.
- **Communicate result limits:** Limit responses to 50 rows and clearly tell users when results have been capped.

## Testing and Evaluation

Prompt design and refinement were among the most time-consuming parts of the project. We went through several rounds of testing to improve SQL generation, ensure queries matched the intended questions, and make the assistant's interpretation of results more reliable.

We evaluated the assistant using **48 test questions across 12 categories**, with four questions per category.

| | | |
|---|---|---|
| Basic sales | Product identification | Top-N questions |
| Filtering | Weekly sales | Promotions |
| Product characteristics | Missing data | Multiple language tests |
| Questions beyond the available data | Ambiguous questions | Multi-table queries |

For each test question, we reviewed the generated SQL and checked the returned results against the database. We then assessed whether the final answer accurately reflected those results and addressed the user's question.

The evaluation covered both the correctness of database queries and the assistant's handling of different types of requests, including ambiguous questions, unsupported questions, and questions requiring information from multiple tables.

This testing helped us identify where the prompt needed refinement and improve the consistency of the assistant's responses. The evaluation was based on the 48-question test set and should not be interpreted as a guarantee that every possible question will be answered correctly.

## Tech Stack

- **Data engineering:** Apache Spark, Databricks, Delta tables
- **Data access:** Databricks SQL warehouse and Databricks SDK
- **AI agent:** OpenAI Agents SDK and the configured language model
- **Application:** Databricks Apps, Next.js, Node.js
- **Monitoring and tracing:** MLflow

## Running the Project

The application was developed and hosted in Databricks using Databricks Repos. We could not connect the project from GitHub to our private workspace, so the repository contains the finished code after our final presentation.

**The project cannot be run as-is without access to the original data and the configured Databricks environment.** Running it would require the appropriate Gold tables, a Databricks SQL warehouse, the required permissions, and the necessary application configuration and API credentials.

The repository is intended to document the project, its architecture, and the implementation rather than provide a fully reproducible deployment.

## Limitations

- **Limited to the available data:** The assistant can answer questions only when the required information is supported by the connected database and its documented schema.
- **No calendar dates:** The dataset contains week numbers from 1 to 52 rather than exact dates. Analysis by calendar month, season, or holiday is therefore limited.
- **Unit sales only:** The available data supports unit-sales analysis but does not include prices, revenue, or profit.
- **Data quality constraints:** The results depend on the quality and completeness of the supplied data. Missing or invalid values can limit the reliability of some analyses.
- **SQL generation is not infallible:** Although the prompt and testing were designed to improve reliability, generated SQL and final answers can still require verification.
- **Environment dependency:** The application relies on access to the configured Databricks workspace, SQL warehouse, tables, and required credentials.
- **Prototype status:** This was an educational course project, not a production-ready business application.

## My Role

I contributed to the development of the data pipeline across the Bronze, Silver, and Gold layers, the design of the Gold tables, and the AI agent, including its system prompt and SQL execution tool. These were team efforts, and we collaborated and supported each other throughout the project.

Hanin Maalla was responsible for building the frontend.

## Future Improvements

- **Exact dates in the data:** Adding calendar dates would enable analysis by month, season, and holidays, helping us investigate questions such as how promotional performance changes around holidays.
- **Saved conversations and user-specific sessions:** Persistent conversation history could allow users to return to previous analyses. This would require a separate storage mechanism with appropriate write permissions, while keeping the Gold data read-only.
- **Automated evaluation:** A larger test set and automated checks could systematically evaluate SQL correctness, result accuracy, handling of missing data, and responses to unsupported questions.
- **Production data pipeline:** Replacing the static sample with regularly updated data would allow us to implement scheduled ingestion and transformation jobs in Databricks.
- **Improved charting and analysis:** Additional visualization options and more advanced analytical questions could make the assistant more useful for business stakeholders.

## What I Learned

- **Prompt design is iterative:** Small changes to the instructions can affect SQL generation and how results are explained.
- **Data modeling influences AI performance:** Designing Gold tables around expected business questions makes SQL generation simpler and reduces the complexity of the agent's task.
- **Data quality must be considered throughout the pipeline:** Cleaning data and retaining missing-value flags helps the assistant communicate limitations rather than presenting every result without context.
- **Testing is essential:** Reviewing both the generated SQL and the final answer helps identify problems that may not be obvious from the response alone.
- **AI applications require integration work:** A useful assistant depends not only on the language model, but also on the data pipeline, SQL execution, application configuration, and frontend.

## Credits

- Built on the [Databricks App Templates](https://github.com/databricks/app-templates) (Apache-2.0).
- **Course:** SpikeUp AI.
- **Team:** Hanin Maalla, Eray Can, Riam Alali, Ramia Mansour, and Zakaria Suleiman.

This project was developed collaboratively as part of the SpikeUp AI course.
