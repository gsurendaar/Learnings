// Optimized types for storing analysis data (removes unnecessary API metadata)
export interface OptimizedEmployee {
  id: number;
  qid: string;
  userid: string;
  name?: string;
  title?: string;
  manager?: string;
}

export interface OptimizedRepository {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  owner: {
    login: string;
  };
  private: boolean;
  language?: string;
  created_at: string;
  updated_at: string;
}

export interface OptimizedCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

export interface OptimizedCommitAnalysis {
  employee: OptimizedEmployee;
  repository: OptimizedRepository;
  commits: OptimizedCommit[];
  dateRange: {
    start: string;
    end: string;
  };
  summary: {
    totalCommits: number;
    totalAdditions: number;
    totalDeletions: number;
    totalChanges: number;
    filesModified: number;
    averageCommitsPerDay: number;
    mostActiveDay: string;
    commitsByDay: Record<string, number>;
    commitsByHour: Record<string, number>;
    languageBreakdown: Record<string, number>;
    commitTypes: Record<string, number>;
  };
  generatedAt: string;
}

// Employee and Repository types (keeping original for compatibility)
export interface Employee {
  id: number;
  qid: string;
  userid: string;
  name?: string;
  title?: string;
  manager?: string;
  reportees?: any; // JSON field
  people_manager?: number;
  updated_at?: string;

  // Optional fields for compatibility
  email?: string;
  username?: string;
  github_username?: string;
  department?: string;
  role?: string;
  avatar_url?: string;
  created_at?: string;
}

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  private: boolean;
  language?: string;
  size: number;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  last_commit_date?: string | null;
  permissions?: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

export interface GitCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
    tree: {
      sha: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
  committer: {
    login: string;
    avatar_url: string;
  } | null;
  url: string;
  html_url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}

export interface CommitAnalysis {
  employee: Employee;
  repository: Repository;
  commits: GitCommit[];
  dateRange: {
    start: string;
    end: string;
  };
  summary: {
    totalCommits: number;
    totalAdditions: number;
    totalDeletions: number;
    totalChanges: number;
    filesModified: number;
    averageCommitsPerDay: number;
    mostActiveDay: string;
    commitsByDay: Record<string, number>;
    commitsByHour: Record<string, number>;
    languageBreakdown: Record<string, number>;
    commitTypes: Record<string, number>;
  };
  generatedAt: string;
}

export interface AnalysisRequest {
  employees: string[]; // Changed from number[] to string[] to handle userids
  repositories: string[];
  dateRange: {
    start: string;
    end: string;
  };
  includeFileChanges: boolean;
  analysisType: "individual" | "team" | "repository";
  reportName?: string; // Add optional reportName field
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message: string;
  count?: number;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Dashboard analytics types
export interface DashboardStats {
  totalEmployees: number;
  totalRepositories: number;
  totalCommits: number;
  totalAnalyses: number;
  topContributors: Array<{
    employee: Employee;
    commitCount: number;
    linesAdded: number;
    linesDeleted: number;
  }>;
  mostActiveRepositories: Array<{
    repository: Repository;
    commitCount: number;
    contributorCount: number;
  }>;
  commitTrends: Array<{
    date: string;
    commits: number;
    additions: number;
    deletions: number;
  }>;
}

export interface FilterOptions {
  employees?: number[];
  repositories?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  departments?: string[];
  languages?: string[];
  commitTypes?: string[];
}
