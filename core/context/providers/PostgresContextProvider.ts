import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../index.js";
import { BaseContextProvider } from "../index.js";

// PostgreSQL identifiers (schema/table names) may only contain unquoted
// identifier characters. Anything else must be rejected rather than quoted,
// because quoting rules differ per identifier and a crafted value could still
// break out of a quoted identifier.
const POSTGRES_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

const MAX_SAMPLE_ROWS = 1000;

function assertSafeIdentifier(value: string, label: string): void {
  if (!POSTGRES_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid PostgreSQL ${label} "${value}": only alphanumeric identifiers (letters, digits, underscore, $) are allowed.`,
    );
  }
}

class PostgresContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "postgres",
    displayTitle: "PostgreSQL",
    description: "Retrieve PostgreSQL table schema and sample rows",
    type: "submenu",
    renderInlineAs: "",
  };

  static ALL_TABLES = "__all_tables";
  static DEFAULT_SAMPLE_ROWS = 3;

  private pool: any;
  private poolPromise: Promise<any> | null = null;

  /**
   * Lazily create a single shared pool for this provider instance and reuse it
   * across calls. The pool is released with `end()` when the provider is
   * disposed so sockets/timers do not accumulate.
   */
  private async getPool(): Promise<any> {
    if (this.poolPromise) {
      return this.poolPromise;
    }
    this.poolPromise = (async () => {
      // @ts-ignore
      const pg = await import("pg");
      this.pool = new pg.Pool({
        host: this.options.host,
        port: this.options.port,
        user: this.options.user,
        password: this.options.password,
        database: this.options.database,
      });
      return this.pool;
    })();
    return this.poolPromise;
  }

  private async closePool(): Promise<void> {
    this.poolPromise = null;
    const pool = this.pool;
    this.pool = undefined;
    if (pool && typeof pool.end === "function") {
      try {
        await pool.end();
      } catch (error) {
        console.warn("Failed to close PostgreSQL pool:", error);
      }
    }
  }

  private async getTableNames(pool: any): Promise<string[]> {
    const schema = this.options.schema ?? "public";
    let tablesInfoQuery = `
SELECT table_schema, table_name
FROM information_schema.tables`;
    const params: string[] = [];
    if (schema !== null) {
      assertSafeIdentifier(schema, "schema");
      tablesInfoQuery += ` WHERE table_schema = $1`;
      params.push(schema);
    }
    const { rows: tablesInfo } = await pool.query(tablesInfoQuery, params);
    return tablesInfo.map(
      (tableInfo: any) => `${tableInfo.table_schema}.${tableInfo.table_name}`,
    );
  }

  async getContextItems(
    query = "",
    _: ContextProviderExtras = {} as ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const pool = await this.getPool();

    try {
      const contextItems: ContextItem[] = [];

      const tableNames = [];
      if (query === PostgresContextProvider.ALL_TABLES) {
        tableNames.push(...(await this.getTableNames(pool)));
      } else {
        tableNames.push(query);
      }

      for (const tableName of tableNames) {
        // Get the table schema
        if (!tableName.includes(".")) {
          throw new Error(
            `Table name must be in format schema.table_name, got ${tableName}`,
          );
        }
        const schema = tableName.split(".")[0];
        const table = tableName.split(".").slice(1).join(".");
        assertSafeIdentifier(schema, "schema");
        assertSafeIdentifier(table, "table name");
        const schemaQuery = `
SELECT column_name, data_type, character_maximum_length
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = $1
  AND table_name = $2`;
        const { rows: tableSchema } = await pool.query(schemaQuery, [
          schema,
          table,
        ]);

        // Get the sample rows
        const rawSampleRows =
          this.options.sampleRows ??
          PostgresContextProvider.DEFAULT_SAMPLE_ROWS;
        if (
          !Number.isInteger(rawSampleRows) ||
          rawSampleRows < 0 ||
          rawSampleRows > MAX_SAMPLE_ROWS
        ) {
          throw new Error(
            `sampleRows must be an integer between 0 and ${MAX_SAMPLE_ROWS}, got ${rawSampleRows}`,
          );
        }
        const { rows: sampleRowResults } = await pool.query(
          `SELECT *
FROM "${schema}"."${table}"
LIMIT ${rawSampleRows}`,
        );

        // Create prompt from the table schema and sample rows
        let prompt = `Postgres schema for database ${this.options.database} table ${tableName}:\n`;
        prompt += `${JSON.stringify(tableSchema, null, 2)}\n\n`;
        prompt += `Sample rows: ${JSON.stringify(sampleRowResults, null, 2)}`;

        contextItems.push({
          name: `${this.options.database}-${tableName}-schema-and-sample-rows`,
          description: `Schema and sample rows for table ${tableName}`,
          content: prompt,
        });
      }

      return contextItems;
    } catch (error) {
      throw new Error(`Failed to query PostgreSQL database: ${error}`);
    }
  }

  async loadSubmenuItems(
    _: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const pool = await this.getPool();

    try {
      const contextItems: ContextSubmenuItem[] = [];
      const tableNames = await this.getTableNames(pool);

      for (const tableName of tableNames) {
        contextItems.push({
          id: tableName,
          title: tableName,
          description: `Schema from ${tableName} and ${this.options.sampleRows} sample rows.`,
        });
      }
      contextItems.push({
        id: PostgresContextProvider.ALL_TABLES,
        title: "All tables",
        description: `Schema from all tables and ${this.options.sampleRows} sample rows each.`,
      });

      return contextItems;
    } catch (error) {
      throw new Error(`Failed to query PostgreSQL database: ${error}`);
    }
  }

  get deprecationMessage() {
    return "The Postgres context provider is deprecated. Please consider using the Postgres MCP (such as github.com/crystaldba/postgres-mcp) instead.";
  }
}

export default PostgresContextProvider;
