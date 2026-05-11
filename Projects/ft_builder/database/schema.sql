-- Git Analytics Database Schema
-- Database: qualitydashboard
-- Legacy users table (kept for compatibility)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    github_username VARCHAR(100),
    department VARCHAR(100),
    role VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_username (username),
    INDEX idx_github_username (github_username),
    INDEX idx_department (department)
);

-- Main employees table (nquality_users) - PayPal Employee Database
CREATE TABLE IF NOT EXISTS nquality_users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    qid VARCHAR(50) NOT NULL,
    userid VARCHAR(100) NOT NULL,
    name VARCHAR(100) CHARACTER
    SET
        utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
        title VARCHAR(100) CHARACTER
    SET
        utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
        manager VARCHAR(100) DEFAULT NULL,
        reportees JSON DEFAULT NULL,
        people_manager INT DEFAULT NULL,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, userid) USING BTREE,
        UNIQUE KEY uniqs (userid, qid),
        KEY Generic (userid, manager, people_manager) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 65536 DEFAULT CHARSET = utf8mb3;

-- Analysis history table
CREATE TABLE IF NOT EXISTS analysis_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    report_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    public_filename VARCHAR(255) NOT NULL,
    analysis_type ENUM ('individual', 'team', 'repository') NOT NULL,
    employee_count INT NOT NULL DEFAULT 0,
    repository_count INT NOT NULL DEFAULT 0,
    date_range_start DATE NOT NULL,
    date_range_end DATE NOT NULL,
    total_commits INT DEFAULT 0,
    total_additions INT DEFAULT 0,
    total_deletions INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_report_name (report_name),
    INDEX idx_analysis_type (analysis_type),
    INDEX idx_date_range (date_range_start, date_range_end),
    INDEX idx_created_at (created_at)
);

-- Repositories table (cached GitHub repository data)
CREATE TABLE IF NOT EXISTS repositories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    github_id BIGINT NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    html_url VARCHAR(500) NOT NULL,
    clone_url VARCHAR(500) NOT NULL,
    ssh_url VARCHAR(500) NOT NULL,
    owner_login VARCHAR(255) NOT NULL,
    owner_avatar_url VARCHAR(500),
    private BOOLEAN DEFAULT TRUE,
    language VARCHAR(100),
    size INT DEFAULT 0,
    stargazers_count INT DEFAULT 0,
    forks_count INT DEFAULT 0,
    open_issues_count INT DEFAULT 0,
    default_branch VARCHAR(100) DEFAULT 'main',
    github_created_at TIMESTAMP NULL,
    github_updated_at TIMESTAMP NULL,
    github_pushed_at TIMESTAMP NULL,
    last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_github_id (github_id),
    INDEX idx_full_name (full_name),
    INDEX idx_owner_login (owner_login),
    INDEX idx_language (language),
    INDEX idx_private (private)
);

-- Commits table (cached commit data)
CREATE TABLE IF NOT EXISTS commits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sha VARCHAR(40) NOT NULL,
    repository_id INT NOT NULL,
    author_name VARCHAR(255),
    author_email VARCHAR(255),
    author_date TIMESTAMP,
    committer_name VARCHAR(255),
    committer_email VARCHAR(255),
    committer_date TIMESTAMP,
    message TEXT,
    author_login VARCHAR(255),
    committer_login VARCHAR(255),
    additions INT DEFAULT 0,
    deletions INT DEFAULT 0,
    total_changes INT DEFAULT 0,
    files_changed INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_sha_repo (sha, repository_id),
    FOREIGN KEY (repository_id) REFERENCES repositories (id) ON DELETE CASCADE,
    INDEX idx_sha (sha),
    INDEX idx_repository_id (repository_id),
    INDEX idx_author_email (author_email),
    INDEX idx_author_login (author_login),
    INDEX idx_author_date (author_date),
    INDEX idx_committer_date (committer_date)
);

-- Employee repository access table
CREATE TABLE IF NOT EXISTS employee_repositories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    repository_id INT NOT NULL,
    access_level ENUM ('read', 'write', 'admin') DEFAULT 'read',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_employee_repo (employee_id, repository_id),
    FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (repository_id) REFERENCES repositories (id) ON DELETE CASCADE,
    INDEX idx_employee_id (employee_id),
    INDEX idx_repository_id (repository_id),
    INDEX idx_access_level (access_level)
);

-- Commit analysis cache table
CREATE TABLE IF NOT EXISTS commit_analysis_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    repository_id INT NOT NULL,
    date_range_start DATE NOT NULL,
    date_range_end DATE NOT NULL,
    total_commits INT DEFAULT 0,
    total_additions INT DEFAULT 0,
    total_deletions INT DEFAULT 0,
    total_changes INT DEFAULT 0,
    files_modified INT DEFAULT 0,
    average_commits_per_day DECIMAL(10, 2) DEFAULT 0,
    most_active_day DATE,
    commit_types JSON,
    language_breakdown JSON,
    commits_by_day JSON,
    commits_by_hour JSON,
    analysis_data JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_analysis_cache (
        employee_id,
        repository_id,
        date_range_start,
        date_range_end
    ),
    FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (repository_id) REFERENCES repositories (id) ON DELETE CASCADE,
    INDEX idx_employee_id (employee_id),
    INDEX idx_repository_id (repository_id),
    INDEX idx_date_range (date_range_start, date_range_end),
    INDEX idx_created_at (created_at)
);

-- Sample data for users table
INSERT INTO
    users (
        name,
        email,
        username,
        github_username,
        department,
        role
    )
VALUES
    (
        'John Doe',
        'john.doe@paypal.com',
        'johndoe',
        'johndoe-paypal',
        'Engineering',
        'Senior Developer'
    ),
    (
        'Jane Smith',
        'jane.smith@paypal.com',
        'janesmith',
        'janesmith-paypal',
        'Engineering',
        'Tech Lead'
    ),
    (
        'Mike Johnson',
        'mike.johnson@paypal.com',
        'mikejohnson',
        'mikej-paypal',
        'Engineering',
        'Developer'
    ),
    (
        'Sarah Wilson',
        'sarah.wilson@paypal.com',
        'sarahwilson',
        'sarahw-paypal',
        'Engineering',
        'Senior Developer'
    ),
    (
        'David Brown',
        'david.brown@paypal.com',
        'davidbrown',
        'davidb-paypal',
        'Engineering',
        'Principal Engineer'
    ) ON DUPLICATE KEY
UPDATE name =
VALUES
    (name),
    github_username =
VALUES
    (github_username),
    department =
VALUES
    (department),
    role =
VALUES
    (role),
    updated_at = CURRENT_TIMESTAMP;

-- Sample data for nquality_users table (PayPal Employee Database)
INSERT INTO
    nquality_users (
        qid,
        userid,
        name,
        title,
        manager,
        people_manager,
        updated_at
    )
VALUES
    (
        'kahmed123',
        'khizahmed',
        'Khiz Ahmed',
        'Senior Software Engineer',
        'Sarah Wilson',
        0,
        CURRENT_TIMESTAMP
    ),
    (
        'jdoe123',
        'johndoe',
        'John Doe',
        'Senior Software Engineer',
        'Jane Smith',
        0,
        CURRENT_TIMESTAMP
    ),
    (
        'jsmith456',
        'janesmith',
        'Jane Smith',
        'Engineering Manager',
        'David Brown',
        1,
        CURRENT_TIMESTAMP
    ),
    (
        'mjohnson789',
        'mikejohnson',
        'Mike Johnson',
        'Software Engineer',
        'Jane Smith',
        0,
        CURRENT_TIMESTAMP
    ),
    (
        'swilson101',
        'sarahwilson',
        'Sarah Wilson',
        'Senior Software Engineer',
        'Jane Smith',
        0,
        CURRENT_TIMESTAMP
    ),
    (
        'dbrown202',
        'davidbrown',
        'David Brown',
        'Principal Engineer',
        'Emily Chen',
        1,
        CURRENT_TIMESTAMP
    ),
    (
        'echen303',
        'emilychen',
        'Emily Chen',
        'Director of Engineering',
        NULL,
        1,
        CURRENT_TIMESTAMP
    ),
    (
        'rgarcia404',
        'robertgarcia',
        'Robert Garcia',
        'Software Engineer',
        'Jane Smith',
        0,
        CURRENT_TIMESTAMP
    ),
    (
        'ldavis505',
        'lindadavis',
        'Linda Davis',
        'Senior Software Engineer',
        'David Brown',
        0,
        CURRENT_TIMESTAMP
    ) ON DUPLICATE KEY
UPDATE name =
VALUES
    (name),
    title =
VALUES
    (title),
    manager =
VALUES
    (manager),
    people_manager =
VALUES
    (people_manager),
    updated_at = CURRENT_TIMESTAMP;

-- FT Runner: Uses SQLite (data/ft-runner.db) — see src/lib/ftDatabase.ts

-- Create data directory structure
-- Note: This would typically be done via file system operations
-- The application will create these directories automatically:
-- ./data/
-- ./data/analyses/
-- ./data/exports/
-- ./data/cache/
-- ./data/ft-artifacts/