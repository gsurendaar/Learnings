// Database response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message: string;
  count?: number;
}

// User interface (adjust fields according to your actual users table structure)
export interface User {
  id: number;
  name?: string;
  email?: string;
  username?: string;
  created_at?: string;
  updated_at?: string;
  // Add other fields as per your users table schema
}

// Database query result
export interface QueryResult {
  affectedRows?: number;
  insertId?: number;
  warningCount?: number;
}
