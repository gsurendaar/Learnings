import https from "https";
import { Repository, GitCommit } from "@/types/git";

class GitHubService {
  private readonly apiHostname: string;
  private readonly apiPathPrefix: string;
  private readonly token: string;

  constructor(token: string, githubBaseUrl?: string) {
    const configuredUrl = githubBaseUrl || process.env.GITHUB_BASE_URL || "https://github.com";
    const parsed = new URL(configuredUrl.startsWith("http") ? configuredUrl : `https://${configuredUrl}`);

    // EMU and public GitHub use api.github.com; on-prem uses hostname/api/v3
    if (parsed.hostname === "github.com") {
      this.apiHostname = "api.github.com";
      this.apiPathPrefix = "";
    } else {
      this.apiHostname = parsed.hostname;
      this.apiPathPrefix = "/api/v3";
    }

    this.token = token;
    console.log(`GitHub service initialized: ${this.apiHostname}${this.apiPathPrefix} token=${token ? `${token.substring(0, 8)}...` : "undefined"}`);
  }

  // Make API request using native HTTPS (similar to fetchrepos.js)
  private makeRequest(endpoint: string, page = 1, perPage = 100): Promise<any> {
    return new Promise((resolve, reject) => {
      const path = `${this.apiPathPrefix}${endpoint}${
        endpoint.includes("?") ? "&" : "?"
      }page=${page}&per_page=${perPage}`;

      const options = {
        hostname: this.apiHostname,
        port: 443,
        path: path,
        method: "GET",
        headers: {
          Authorization: `token ${this.token}`,
          "User-Agent": "GitLogs-Analytics/1.0",
          Accept: "application/vnd.github.v3+json",
        },
        rejectUnauthorized: false,
      };

      console.log(`Making request to: https://${this.apiHostname}${path}`);

      const req = https.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          console.log(`Response status: ${statusCode}`);
          console.log(`Response data: ${data.substring(0, 200)}...`);
          
          if (statusCode >= 200 && statusCode < 300) {
            try {
              const jsonData = JSON.parse(data);
              resolve({
                data: jsonData,
                headers: res.headers,
                statusCode: statusCode,
              });
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              reject(new Error(`Failed to parse JSON: ${errorMessage}`));
            }
          } else {
            reject(
              new Error(`API request failed with status ${statusCode}: ${data}`)
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.end();
    });
  }

  // Get all pages of results (similar to fetchrepos.js)
  private async getAllPages(endpoint: string): Promise<any[]> {
    const allResults = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      try {
        const response = await this.makeRequest(endpoint, page);
        const data = response.data;

        if (Array.isArray(data)) {
          allResults.push(...data);
          hasNextPage = data.length === 100; // If we got 100 results, there might be more
        } else {
          allResults.push(data);
          hasNextPage = false;
        }

        page++;

        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`Error fetching page ${page}:`, errorMessage);
        hasNextPage = false;
      }
    }

    return allResults;
  }

  // Get user repositories (repos owned by user — may miss org repos)
  async getUserRepositories(username: string): Promise<Repository[]> {
    try {
      console.log(`Fetching all repositories for user: ${username}`);
      const repos = await this.getAllPages(
        `/users/${username}/repos?sort=updated&direction=desc`
      );
      console.log(`Found ${repos.length} repositories for ${username}`);

      return this.processRepositories(repos);
    } catch (error) {
      console.error(`Error fetching repositories for ${username}:`, error);
      throw error;
    }
  }

  // Get repositories where the authenticated user can contribute (push access)
  async getAuthenticatedUserRepos(): Promise<Repository[]> {
    try {
      console.log("Fetching contributable repositories for authenticated user");
      const repos = await this.getAllPages(
        `/user/repos?sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`
      );
      const contributable = repos.filter((repo: any) => repo.permissions?.push === true);
      console.log(`Found ${contributable.length} contributable repos (push access) out of ${repos.length} total`);
      return this.processRepositories(contributable);
    } catch (error) {
      console.error("Error fetching authenticated user repositories:", error);
      throw error;
    }
  }

  // Get organization repositories
  async getOrgRepositories(org: string): Promise<Repository[]> {
    try {
      console.log(`Fetching all repositories for organization: ${org}`);
      const repos = await this.getAllPages(
        `/orgs/${org}/repos?sort=updated&direction=desc`
      );
      console.log(`Found ${repos.length} repositories for organization ${org}`);

      return this.processRepositories(repos);
    } catch (error) {
      console.error(`Error fetching repositories for org ${org}:`, error);
      throw error;
    }
  }

  // Process and format repository data
  private processRepositories(repos: any[]): Repository[] {
    return repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description || "No description",
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      owner: {
        login: repo.owner.login,
        avatar_url: repo.owner.avatar_url,
      },
      private: repo.private,
      language: repo.language,
      size: repo.size,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      open_issues_count: repo.open_issues_count,
      default_branch: repo.default_branch,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
      permissions: repo.permissions,
    }));
  }

  // Get commits for a repository within date range
  async getRepositoryCommits(
    owner: string,
    repo: string,
    since: string,
    until: string,
    author?: string
  ): Promise<GitCommit[]> {
    try {
      const startTime = Date.now();

      let endpoint = `/repos/${owner}/${repo}/commits?since=${since}&until=${until}`;
      if (author) {
        endpoint += `&author=${author}`;
      }

      const commits = await this.getAllPages(endpoint);

      const duration = (Date.now() - startTime) / 1000;
      console.log(
        `Fetched ${commits.length} commits from ${owner}/${repo} ${
          author ? `for ${author}` : ""
        } in ${duration.toFixed(2)}s`
      );

      return commits as GitCommit[];
    } catch (error) {
      console.error(`Error fetching commits for ${owner}/${repo}:`, error);
      throw error;
    }
  }

  // Get detailed commit information including stats
  async getCommitDetails(
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitCommit> {
    try {
      const response = await this.makeRequest(
        `/repos/${owner}/${repo}/commits/${sha}`
      );
      return response.data as GitCommit;
    } catch (error) {
      console.error(`Error fetching commit details for ${sha}:`, error);
      throw error;
    }
  } // Get all commits for multiple repositories with batching
  async getMultipleRepositoryCommits(
    repositories: Array<{ owner: string; repo: string }>,
    since: string,
    until: string,
    author?: string
  ): Promise<Record<string, GitCommit[]>> {
    const startTime = Date.now();
    console.log(
      `Fetching commits from ${repositories.length} repositories for author: ${
        author || "all"
      }`
    );

    const results: Record<string, GitCommit[]> = {};
    const batchSize = 5; // Smaller batch size for repository calls

    // Process repositories in batches to avoid overwhelming the API
    for (let i = 0; i < repositories.length; i += batchSize) {
      const batch = repositories.slice(i, i + batchSize);
      const batchStartTime = Date.now();

      // Create promises for this batch
      const batchPromises = batch.map(async ({ owner, repo }) => {
        try {
          const commits = await this.getRepositoryCommits(
            owner,
            repo,
            since,
            until,
            author
          );
          return { key: `${owner}/${repo}`, commits };
        } catch (error) {
          console.error(`Failed to fetch commits for ${owner}/${repo}:`, error);
          return { key: `${owner}/${repo}`, commits: [] };
        }
      });

      // Wait for all promises in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Add results to the main results object
      batchResults.forEach(({ key, commits }) => {
        results[key] = commits;
      });

      const batchTime = (Date.now() - batchStartTime) / 1000;
      console.log(
        `Repository batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          repositories.length / batchSize
        )} completed in ${batchTime.toFixed(2)}s`
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < repositories.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    const totalCommits = Object.values(results).reduce(
      (sum, commits) => sum + commits.length,
      0
    );
    console.log(
      `Completed fetching ${totalCommits} commits from ${
        repositories.length
      } repositories in ${totalTime.toFixed(2)}s`
    );

    return results;
  }

  // Get detailed commits with stats using proper batching
  async getDetailedCommits(
    owner: string,
    repo: string,
    commits: GitCommit[]
  ): Promise<GitCommit[]> {
    const startTime = Date.now();
    console.log(
      `Fetching detailed information for ${commits.length} commits from ${owner}/${repo}`
    );

    const detailedCommits: GitCommit[] = [];
    const batchSize = 10;

    // Process commits in batches to avoid overwhelming the API
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize);
      const batchStartTime = Date.now();

      // Create promises for this batch
      const batchPromises = batch.map(async (commit) => {
        try {
          const detailed = await this.getCommitDetails(owner, repo, commit.sha);
          return detailed;
        } catch (error) {
          console.error(
            `Failed to fetch details for commit ${commit.sha}:`,
            error
          );
          return commit; // Return original commit if details fail
        }
      });

      // Wait for all promises in this batch to complete
      const batchResults = await Promise.all(batchPromises);
      detailedCommits.push(...batchResults);

      const batchTime = (Date.now() - batchStartTime) / 1000;
      console.log(
        `Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          commits.length / batchSize
        )} completed in ${batchTime.toFixed(2)}s`
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < commits.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(
      `Completed fetching detailed commits in ${totalTime.toFixed(2)}s`
    );

    return detailedCommits;
  }

  // Search repositories
  async searchRepositories(query: string, org?: string): Promise<Repository[]> {
    try {
      let searchQuery = query;
      if (org) {
        searchQuery += ` org:${org}`;
      }

      const response = await this.makeRequest(
        `/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=updated`
      );
      return this.processRepositories(response.data.items || []);
    } catch (error) {
      console.error("Error searching repositories:", error);
      throw error;
    }
  }

  // Get user profile
  async getUserProfile(username: string) {
    try {
      const response = await this.makeRequest(`/users/${username}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching user profile for ${username}:`, error);
      throw error;
    }
  }

  // Get repository details
  async getRepository(fullName: string): Promise<Repository | null> {
    try {
      const response = await this.makeRequest(`/repos/${fullName}`);
      return response.data as Repository;
    } catch (error) {
      console.error(`Error fetching repository ${fullName}:`, error);
      return null;
    }
  }

  // Validate token
  async validateToken(): Promise<boolean> {
    try {
      console.log("Attempting to validate token with base URL:", this.apiHostname);
      const response = await this.makeRequest("/user");
      console.log("Token validation successful:", response.data.login);
      return true;
    } catch (error) {
      console.error("Invalid GitHub token:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Error message:", errorMessage);
      return false;
    }
  }

  // Validate token and return the authenticated user's profile
  async validateTokenAndGetUser(): Promise<{ login: string; name: string; avatar_url: string }> {
    const response = await this.makeRequest("/user");
    return response.data;
  }

  // Get latest commit for a repository (for last access date)
  async getLatestCommit(owner: string, repo: string): Promise<string | null> {
    try {
      console.log(`Fetching latest commit for ${owner}/${repo}`);
      const response = await this.makeRequest(
        `/repos/${owner}/${repo}/commits?per_page=1`
      );
      
      if (response.data && response.data.length > 0) {
        const latestCommit = response.data[0];
        const commitDate = latestCommit.commit.author.date;
        console.log(`Latest commit for ${owner}/${repo}: ${commitDate}`);
        return commitDate;
      }
      
      console.log(`No commits found for ${owner}/${repo}`);
      return null;
    } catch (error) {
      console.error(`Error fetching latest commit for ${owner}/${repo}:`, error);
      return null;
    }
  }

  // Get user repositories with latest commit dates
  async getUserRepositoriesWithLastCommit(username: string): Promise<Repository[]> {
    try {
      console.log(`Fetching all repositories for user: ${username} with latest commit dates`);
      const repos = await this.getAllPages(
        `/users/${username}/repos?sort=updated&direction=desc`
      );
      console.log(`Found ${repos.length} repositories for ${username}`);

      return this.processRepositoriesWithLastCommit(repos);
    } catch (error) {
      console.error(`Error fetching repositories for ${username}:`, error);
      throw error;
    }
  }

  // Get organization repositories with latest commit dates
  async getOrgRepositoriesWithLastCommit(org: string): Promise<Repository[]> {
    try {
      console.log(`Fetching all repositories for organization: ${org} with latest commit dates`);
      const repos = await this.getAllPages(
        `/orgs/${org}/repos?sort=updated&direction=desc`
      );
      console.log(`Found ${repos.length} repositories for organization ${org}`);

      return this.processRepositoriesWithLastCommit(repos);
    } catch (error) {
      console.error(`Error fetching repositories for org ${org}:`, error);
      throw error;
    }
  }

  // Process repositories and fetch their latest commit dates
  private async processRepositoriesWithLastCommit(repos: any[]): Promise<Repository[]> {
    console.log(`Processing ${repos.length} repositories with latest commit dates`);
    
    // First process the basic repository data
    const processedRepos = this.processRepositories(repos);
    
    // Then fetch latest commit dates in batches to avoid overwhelming the API
    const batchSize = 10;
    const reposWithCommitDates: Repository[] = [];
    
    for (let i = 0; i < processedRepos.length; i += batchSize) {
      const batch = processedRepos.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(processedRepos.length / batchSize)}`);
      
      const batchPromises = batch.map(async (repo) => {
        const [owner, repoName] = repo.full_name.split('/');
        const lastCommitDate = await this.getLatestCommit(owner, repoName);
        
        return {
          ...repo,
          last_commit_date: lastCommitDate
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      reposWithCommitDates.push(...batchResults);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < processedRepos.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    
    console.log(`Completed processing ${reposWithCommitDates.length} repositories with commit dates`);
    return reposWithCommitDates;
  }

  // ============= FT Runner Methods =============

  // Get branches for a repository
  async getBranches(owner: string, repo: string): Promise<Array<{ name: string; commit: { sha: string }; protected: boolean }>> {
    try {
      const branches = await this.getAllPages(`/repos/${owner}/${repo}/branches`);
      return branches.map((b: any) => ({
        name: b.name,
        commit: { sha: b.commit.sha },
        protected: b.protected || false,
      }));
    } catch (error) {
      console.error(`Error fetching branches for ${owner}/${repo}:`, error);
      throw error;
    }
  }

  // Get the file tree for a repository (filtered to a specific path like cypress/e2e)
  async getTree(owner: string, repo: string, branch: string, filterPath?: string): Promise<Array<{ path: string; type: 'blob' | 'tree'; sha: string; size?: number }>> {
    try {
      // First get the branch ref to find the tree SHA
      const refResponse = await this.makeRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const commitSha = refResponse.data.object.sha;

      // Get the commit to find the tree SHA
      const commitResponse = await this.makeRequest(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
      const treeSha = commitResponse.data.tree.sha;

      // Get the full tree recursively
      const treeResponse = await this.makeRequest(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`);
      const items = treeResponse.data.tree || [];

      // Filter to the specified path prefix
      const prefix = filterPath ? (filterPath.endsWith('/') ? filterPath : filterPath + '/') : '';
      return items
        .filter((item: any) => {
          if (!prefix) return true;
          return item.path.startsWith(prefix);
        })
        .map((item: any) => ({
          path: item.path,
          type: item.type === 'tree' ? 'tree' : 'blob',
          sha: item.sha,
          size: item.size,
        }));
    } catch (error) {
      console.error(`Error fetching tree for ${owner}/${repo}@${branch}:`, error);
      throw error;
    }
  }

  // Get file content from a repository
  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
    try {
      const response = await this.makeRequest(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
      const content = response.data.content;
      const encoding = response.data.encoding;

      if (encoding === 'base64') {
        return Buffer.from(content, 'base64').toString('utf-8');
      }
      return content;
    } catch (error) {
      console.error(`Error fetching file content for ${path}:`, error);
      throw error;
    }
  }

  // Utility function to process promises in batches
  private async processBatches<T>(
    promises: Promise<T>[],
    batchSize: number = 10
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < promises.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}

export default GitHubService;
