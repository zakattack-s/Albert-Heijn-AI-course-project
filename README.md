# Albert Heijn AI Data Assistant

An AI assistant that answers stakeholders' questions about product and sales data in plain language. Built in Databricks as a course project for the **SpikeUp AI** course.

> **Disclaimer:** This is an educational project and is not affiliated with Albert Heijn. The data was provided by Albert Heijn for the course and is private. No real data is included in this repository.

https://github.com/user-attachments/assets/81360687-c191-4e8b-a5ac-4bb1521e3617

## The Assignment

Build an AI assistant in Databricks that allows Albert Heijn stakeholders to ask questions about their data and receive reliable answers without having to write SQL.

## What It Does

1. The user asks a question in natural language.
2. The AI agent interprets the question and generates a Spark SQL query.
3. The query is executed against the Gold tables through a Databricks SQL warehouse.
4. The agent uses the query results to generate a natural-language answer.
5. When the user requests a visualization, the agent returns structured chart data as JSON, which the frontend renders as a chart.

### Architecture

<img width="682" height="527" alt="image" src="https://github.com/user-attachments/assets/9a106d14-386e-486a-9f06-fdad1416ca6a" />

## Data Engineering: Medallion Architecture

We received sample data from Albert Heijn and processed it using **Apache Spark in Databricks**, following the Bronze, Silver, and Gold medallion architecture.

### Data Quality Checks

During exploration and transformation, we checked row counts between stages, column names and data types, duplicate products, nulls and placeholder values, joinability between tables, suspicious numeric values (negative, zero), and spelling consistency in text columns.

### Bronze Layer

Raw data was loaded with two additional metadata columns: the ingestion timestamp and the source table. The sample data was already prepared, so these columns were not essential, but we added them to reflect a more realistic data engineering pipeline.

### Silver Layer

Each source table was cleaned and transformed separately.

| Table | Transformations |
|---|---|
| **Products** | Corrected the data type of the weight column and converted placeholder values into proper nulls. |
| **Product groups** | Converted missing group values into nulls. |
| **Promotions** | Split promotion weeks into separate rows, one row per product per promotion week. Converted non-numeric symbols into nulls and added a flag for missing values. |
| **Sales** | Converted to long format, one row per product per week. Converted missing values into nulls, treated zero sales values as invalid based on guidance from our project supervisor, and added a flag for missing or invalid sales data. |
| **Delivery_unit** | Converted zeros into nulls and added a flag for missing values. |

Zero sales values were converted to nulls rather than interpreted as genuine zero-unit sales.

### Gold Layer

We designed the Gold tables around the business questions the assistant needed to answer, to make the data easier to query and reduce the complexity of the SQL the agent needed to generate.

| Table | Purpose |
|---|---|
| **Product characteristics** | Combines product and delivery-unit attributes, including descriptions, dimensions, weights, expiry information, and delivery-unit details. |
| **Weekly sales** | Weekly sales enriched with product categories, groups, and promotion information. |
| **Aggregated sales** | One row per product with total, average, minimum, maximum, and standard deviation of sales, promotional versus non-promotional averages, and the number of promotional weeks. |

**Missing-value flags** were retained in the Gold tables wherever relevant, so the agent can account for known data gaps and communicate limitations when presenting results.

## The Application

The application is based on the **Databricks OpenAI Agents SDK chatbot template**. We adapted it to connect the AI agent to our Gold tables and provide a conversational interface for business questions.

| File or folder | Purpose |
|---|---|
| [`agent_server/agent.py`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/blob/main/Albert%20Heijn%20AI%20assistant/agent_server/agent.py) | Agent setup, system prompt, SQL execution tool, and request handlers. We defined the assistant's scope, SQL rules, data quality instructions, and chart output format. |
| [`e2e-chatbot-app-next/`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/tree/main/Albert%20Heijn%20AI%20assistant/e2e-chatbot-app-next) | Custom chat interface and chart rendering, developed by my teammates. My contribution focused on the data pipeline and AI agent rather than frontend development. |
| [`app.yaml`](https://github.com/zakattack-s/Albert-Heijn-AI-course-project/blob/main/Albert%20Heijn%20AI%20assistant/app.yaml) | Configures the Databricks application and references the required resources. API keys and other secrets are not hardcoded. |

The remaining files are part of the original Databricks template unless otherwise documented.

## System Prompt Guardrails

- **Stay within scope:** Answer questions supported by the connected database. Politely decline unrelated questions and ask for clarification when product references or metrics are ambiguous.
- **Preserve meaning and language:** Respond in the user's language and keep product names, categories, and IDs exactly as stored.
- **Handle failures transparently:** If a SQL query fails, retry once without changing its meaning. If the retry also fails, report the failure rather than inventing a result.
- **Represent data accurately:** Keep missing values distinct from zero, respect data-quality flags, and explain when incomplete or invalid records affect results.
- **Follow output rules:** Present results consistently, generate charts only from retrieved data, and follow the required JSON structure for the frontend.
- **Communicate result limits:** Limit responses to 50 rows and tell users when results have been capped.

## Testing and Evaluation

Prompt design and refinement were among the most time-consuming parts of the project. We went through several rounds of testing to improve SQL generation and make the assistant's interpretation of results more reliable.

We evaluated the assistant using **48 test questions across 12 categories**, with four questions per category.

| | | |
|---|---|---|
| Basic sales | Product identification | Top-N questions |
| Filtering | Weekly sales | Promotions |
| Product characteristics | Missing data | Multiple language tests |
| Questions beyond the available data | Ambiguous questions | Multi-table queries |

For each question, we reviewed the generated SQL, checked the returned results against the database, and assessed whether the final answer accurately reflected those results. The evaluation was based on this 48-question set and should not be interpreted as a guarantee that every possible question will be answered correctly.

## Tech Stack

- **Data engineering:** Apache Spark, Databricks, Delta tables
- **Data access:** Databricks SQL warehouse and Databricks SDK
- **AI agent:** OpenAI Agents SDK and the configured language model
- **Application:** Databricks Apps, Next.js, Node.js
- **Monitoring and tracing:** MLflow

## Running the Project

The application was developed and hosted in Databricks using Databricks Repos. We could not connect the project from GitHub to our private workspace, so the repository contains the finished code after our final presentation.

**The project cannot be run as-is without access to the original data and the configured Databricks environment.** The repository is intended to document the project, its architecture, and the implementation rather than provide a fully reproducible deployment.

## Limitations

- **Limited to the available data:** The assistant can answer questions only when the information is supported by the connected database.
- **No calendar dates:** The dataset contains week numbers from 1 to 52 rather than exact dates, so analysis by month, season, or holiday is limited.
- **Unit sales only:** The data does not include prices, revenue, or profit.
- **Data quality constraints:** Missing or invalid values can limit the reliability of some analyses.
- **SQL generation is not infallible:** Generated SQL and final answers can still require verification.
- **Environment dependency:** The application relies on the configured Databricks workspace, SQL warehouse, tables, and credentials.
- **Prototype status:** This was an educational course project, not a production-ready business application.

## My Role

I contributed to the development of the data pipeline across the Bronze, Silver, and Gold layers, the design of the Gold tables, and the AI agent, including its system prompt and SQL execution tool. These were team efforts, and we collaborated and supported each other throughout the project.

## Future Improvements

- **Exact dates in the data:** Would enable analysis by month, season, and holidays, such as how promotional performance changes around holidays.
- **Saved conversations and user-specific sessions:** Would let users return to previous analyses. This would need a separate storage mechanism, while keeping the Gold data read-only.
- **Automated evaluation:** A larger test set and automated checks for SQL correctness, result accuracy, missing data handling, and unsupported questions.
- **Production data pipeline:** Replacing the static sample with regularly updated data and scheduled ingestion and transformation jobs in Databricks.
- **Improved charting and analysis:** More visualization options and more advanced analytical questions.

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
