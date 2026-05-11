import mysql from "mysql2/promise";

// Database configuration interface
interface DatabaseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  connectionLimit?: number;
}

// Database configuration
const dbConfig: DatabaseConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "qualitydashboard",
  port: parseInt(process.env.DB_PORT || "3306"),
  connectionLimit: 10,
};

// Create connection pool for better performance
const pool = mysql.createPool(dbConfig);

// Database utility functions
export class Database {
  // Execute query with connection pool
  static async query(sql: string, params?: any[]): Promise<any> {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  }

  // Get a single connection from pool
  static async getConnection() {
    try {
      return await pool.getConnection();
    } catch (error) {
      console.error("Database connection error:", error);
      throw error;
    }
  }

  // Close pool (useful for cleanup)
  static async closePool() {
    try {
      await pool.end();
    } catch (error) {
      console.error("Error closing database pool:", error);
      throw error;
    }
  }

  // Test database connection
  static async testConnection(): Promise<boolean> {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      return true;
    } catch (error) {
      console.error("Database connection test failed:", error);
      return false;
    }
  }
}

export default Database;
