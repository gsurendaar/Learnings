"use client";

import { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Table,
  Tag,
  Space,
  Typography,
  Divider,
  Tabs,
  Timeline,
  Calendar,
  Badge,
  Tooltip,
  List,
  Avatar,
} from "antd";
import {
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  CalendarOutlined,
  CodeOutlined,
  BranchesOutlined,
  FileTextOutlined,
  UserOutlined,
  ClockCircleOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { CommitAnalysis, GitCommit } from "@/types/git";
import dayjs from "dayjs";

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;

interface CommitVisualizationProps {
  analysis: CommitAnalysis[];
  teamStats?: any;
}

export default function CommitVisualization({
  analysis,
  teamStats,
}: CommitVisualizationProps) {
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    null
  );

  // Calculate aggregated statistics
  const calculateStats = () => {
    const stats = {
      totalCommits: analysis.reduce(
        (sum, a) => sum + a.summary.totalCommits,
        0
      ),
      totalAdditions: analysis.reduce(
        (sum, a) => sum + a.summary.totalAdditions,
        0
      ),
      totalDeletions: analysis.reduce(
        (sum, a) => sum + a.summary.totalDeletions,
        0
      ),
      totalFilesModified: analysis.reduce(
        (sum, a) => sum + a.summary.filesModified,
        0
      ),
      employeeCount: new Set(analysis.map((a) => a.employee.id)).size,
      repositoryCount: new Set(analysis.map((a) => a.repository.id)).size,
      dateRange: analysis.length > 0 ? analysis[0].dateRange : null,
    };
    return stats;
  };

  const stats = calculateStats();

  // Top contributors
  const getTopContributors = () => {
    const contributors = new Map();

    analysis.forEach((a) => {
      const key = a.employee.id;
      if (!contributors.has(key)) {
        contributors.set(key, {
          employee: a.employee,
          commits: 0,
          additions: 0,
          deletions: 0,
          files: 0,
          repositories: new Set(),
        });
      }

      const contributor = contributors.get(key);
      contributor.commits += a.summary.totalCommits;
      contributor.additions += a.summary.totalAdditions;
      contributor.deletions += a.summary.totalDeletions;
      contributor.files += a.summary.filesModified;
      contributor.repositories.add(a.repository.name);
    });

    return Array.from(contributors.values())
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10);
  };

  // Repository activity
  const getRepositoryActivity = () => {
    const repositories = new Map();

    analysis.forEach((a) => {
      const key = a.repository.id;
      if (!repositories.has(key)) {
        repositories.set(key, {
          repository: a.repository,
          commits: 0,
          additions: 0,
          deletions: 0,
          contributors: new Set(),
        });
      }

      const repo = repositories.get(key);
      repo.commits += a.summary.totalCommits;
      repo.additions += a.summary.totalAdditions;
      repo.deletions += a.summary.totalDeletions;
      repo.contributors.add(a.employee.name);
    });

    return Array.from(repositories.values())
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10);
  };

  // Daily commit activity
  const getDailyActivity = () => {
    const dailyActivity = new Map();

    analysis.forEach((a) => {
      Object.entries(a.summary.commitsByDay).forEach(([day, commits]) => {
        if (!dailyActivity.has(day)) {
          dailyActivity.set(day, 0);
        }
        dailyActivity.set(day, dailyActivity.get(day) + commits);
      });
    });

    return Array.from(dailyActivity.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, commits]) => ({ date, commits }));
  };

  // Commit types analysis
  const getCommitTypeAnalysis = () => {
    const commitTypes = new Map();

    analysis.forEach((a) => {
      Object.entries(a.summary.commitTypes).forEach(([type, count]) => {
        commitTypes.set(type, (commitTypes.get(type) || 0) + count);
      });
    });

    return Array.from(commitTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  };

  // Language breakdown
  const getLanguageBreakdown = () => {
    const languages = new Map();

    analysis.forEach((a) => {
      Object.entries(a.summary.languageBreakdown).forEach(([lang, count]) => {
        languages.set(lang, (languages.get(lang) || 0) + count);
      });
    });

    return Array.from(languages.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([language, count]) => ({ language, count }));
  };

  // Hour-based activity
  const getHourlyActivity = () => {
    const hourlyActivity = new Array(24).fill(0);

    analysis.forEach((a) => {
      Object.entries(a.summary.commitsByHour).forEach(([hour, commits]) => {
        hourlyActivity[parseInt(hour)] += commits;
      });
    });

    return hourlyActivity.map((commits, hour) => ({
      hour: `${hour}:00`,
      commits,
    }));
  };

  const topContributors = getTopContributors();
  const repositoryActivity = getRepositoryActivity();
  const dailyActivity = getDailyActivity();
  const commitTypeAnalysis = getCommitTypeAnalysis();
  const languageBreakdown = getLanguageBreakdown();
  const hourlyActivity = getHourlyActivity();

  // Contributors table columns
  const contributorColumns = [
    {
      title: "Employee",
      key: "employee",
      render: (record: any) => (
        <Space>
          <Avatar icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: "bold" }}>{record.employee.name}</div>
            <div style={{ fontSize: "12px", color: "#666" }}>
              {record.employee.manager || "N/A"}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: "Commits",
      dataIndex: "commits",
      key: "commits",
      render: (value: number) => (
        <Statistic value={value} valueStyle={{ fontSize: "14px" }} />
      ),
    },
    {
      title: "Additions",
      dataIndex: "additions",
      key: "additions",
      render: (value: number) => (
        <Statistic
          value={value}
          valueStyle={{ fontSize: "14px", color: "#52c41a" }}
        />
      ),
    },
    {
      title: "Deletions",
      dataIndex: "deletions",
      key: "deletions",
      render: (value: number) => (
        <Statistic
          value={value}
          valueStyle={{ fontSize: "14px", color: "#ff4d4f" }}
        />
      ),
    },
    {
      title: "Files",
      dataIndex: "files",
      key: "files",
      render: (value: number) => (
        <Statistic value={value} valueStyle={{ fontSize: "14px" }} />
      ),
    },
    {
      title: "Repositories",
      key: "repositories",
      render: (record: any) => (
        <Tag color="blue">{record.repositories.size}</Tag>
      ),
    },
  ];

  // Repository table columns
  const repositoryColumns = [
    {
      title: "Repository",
      key: "repository",
      render: (record: any) => (
        <Space>
          <BranchesOutlined />
          <div>
            <div style={{ fontWeight: "bold" }}>{record.repository.name}</div>
            <div style={{ fontSize: "12px", color: "#666" }}>
              {record.repository.full_name}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: "Commits",
      dataIndex: "commits",
      key: "commits",
      render: (value: number) => (
        <Statistic value={value} valueStyle={{ fontSize: "14px" }} />
      ),
    },
    {
      title: "Contributors",
      key: "contributors",
      render: (record: any) => (
        <Tag color="green">{record.contributors.size}</Tag>
      ),
    },
    {
      title: "Activity",
      key: "activity",
      render: (record: any) => {
        const total = record.additions + record.deletions;
        const additionPercent =
          total > 0 ? (record.additions / total) * 100 : 0;
        return (
          <Progress
            percent={additionPercent}
            showInfo={false}
            strokeColor="#52c41a"
            trailColor="#ff4d4f"
            size="small"
          />
        );
      },
    },
  ];

  return (
    <div style={{ padding: "24px" }}>
      <Title level={3} style={{ marginBottom: "24px" }}>
        <BarChartOutlined style={{ marginRight: "8px" }} />
        Commit Analysis Visualization
      </Title>

      {/* Overview Statistics */}
      <Row gutter={[16, 16]} style={{ marginBottom: "24px" }}>
        <Col span={4}>
          <Card>
            <Statistic
              title="Total Commits"
              value={stats.totalCommits}
              prefix={<BranchesOutlined />}
              valueStyle={{ color: "#1890ff" }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="Lines Added"
              value={stats.totalAdditions}
              prefix={<CodeOutlined />}
              valueStyle={{ color: "#52c41a" }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="Lines Deleted"
              value={stats.totalDeletions}
              prefix={<CodeOutlined />}
              valueStyle={{ color: "#ff4d4f" }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="Files Modified"
              value={stats.totalFilesModified}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: "#fa8c16" }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="Employees"
              value={stats.employeeCount}
              prefix={<UserOutlined />}
              valueStyle={{ color: "#722ed1" }}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="Repositories"
              value={stats.repositoryCount}
              prefix={<BranchesOutlined />}
              valueStyle={{ color: "#13c2c2" }}
            />
          </Card>
        </Col>
      </Row>

      <Tabs defaultActiveKey="contributors" size="large">
        <TabPane
          tab={
            <span>
              <TrophyOutlined />
              Top Contributors
            </span>
          }
          key="contributors"
        >
          <Card>
            <Table
              columns={contributorColumns}
              dataSource={topContributors}
              rowKey={(record) => record.employee.id}
              pagination={false}
              size="small"
            />
          </Card>
        </TabPane>

        <TabPane
          tab={
            <span>
              <BranchesOutlined />
              Repository Activity
            </span>
          }
          key="repositories"
        >
          <Card>
            <Table
              columns={repositoryColumns}
              dataSource={repositoryActivity}
              rowKey={(record) => record.repository.id}
              pagination={false}
              size="small"
            />
          </Card>
        </TabPane>

        <TabPane
          tab={
            <span>
              <CalendarOutlined />
              Daily Activity
            </span>
          }
          key="daily"
        >
          <Card>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Title level={4}>Commits by Day</Title>
                <List
                  size="small"
                  dataSource={dailyActivity.slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item>
                      <Space
                        style={{
                          width: "100%",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text>{dayjs(item.date).format("MMM DD, YYYY")}</Text>
                        <Progress
                          percent={
                            (item.commits /
                              Math.max(
                                ...dailyActivity.map((d) => d.commits)
                              )) *
                            100
                          }
                          showInfo={false}
                          size="small"
                          style={{ width: "100px" }}
                        />
                        <Text strong>{item.commits}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Title level={4}>Hourly Distribution</Title>
                <List
                  size="small"
                  dataSource={hourlyActivity
                    .filter((h) => h.commits > 0)
                    .slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item>
                      <Space
                        style={{
                          width: "100%",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text>{item.hour}</Text>
                        <Progress
                          percent={
                            (item.commits /
                              Math.max(
                                ...hourlyActivity.map((h) => h.commits)
                              )) *
                            100
                          }
                          showInfo={false}
                          size="small"
                          style={{ width: "100px" }}
                        />
                        <Text strong>{item.commits}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Col>
            </Row>
          </Card>
        </TabPane>

        <TabPane
          tab={
            <span>
              <PieChartOutlined />
              Commit Types
            </span>
          }
          key="types"
        >
          <Card>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Title level={4}>Commit Types</Title>
                <List
                  dataSource={commitTypeAnalysis}
                  renderItem={(item) => (
                    <List.Item>
                      <Space
                        style={{
                          width: "100%",
                          justifyContent: "space-between",
                        }}
                      >
                        <Tag color="blue">{item.type}</Tag>
                        <Progress
                          percent={(item.count / stats.totalCommits) * 100}
                          showInfo={false}
                          size="small"
                          style={{ width: "100px" }}
                        />
                        <Text strong>{item.count}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Col>
              <Col span={12}>
                <Title level={4}>Languages</Title>
                <List
                  dataSource={languageBreakdown}
                  renderItem={(item) => (
                    <List.Item>
                      <Space
                        style={{
                          width: "100%",
                          justifyContent: "space-between",
                        }}
                      >
                        <Tag color="green">{item.language}</Tag>
                        <Progress
                          percent={
                            (item.count /
                              languageBreakdown.reduce(
                                (sum, l) => sum + l.count,
                                0
                              )) *
                            100
                          }
                          showInfo={false}
                          size="small"
                          style={{ width: "100px" }}
                        />
                        <Text strong>{item.count}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Col>
            </Row>
          </Card>
        </TabPane>

        <TabPane
          tab={
            <span>
              <ClockCircleOutlined />
              Timeline
            </span>
          }
          key="timeline"
        >
          <Card>
            <Title level={4}>Analysis Timeline</Title>
            <Timeline>
              {analysis.slice(0, 20).map((item, index) => (
                <Timeline.Item
                  key={index}
                  dot={<BranchesOutlined />}
                  color={item.summary.totalCommits > 10 ? "green" : "blue"}
                >
                  <div>
                    <Text strong>{item.employee.name}</Text> worked on{" "}
                    <Text code>{item.repository.name}</Text>
                  </div>
                  <div style={{ marginTop: "4px" }}>
                    <Space>
                      <Tag color="blue">
                        {item.summary.totalCommits} commits
                      </Tag>
                      <Tag color="green">+{item.summary.totalAdditions}</Tag>
                      <Tag color="red">-{item.summary.totalDeletions}</Tag>
                    </Space>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#666",
                      marginTop: "4px",
                    }}
                  >
                    {dayjs(item.dateRange.start).format("MMM DD")} -{" "}
                    {dayjs(item.dateRange.end).format("MMM DD, YYYY")}
                  </div>
                </Timeline.Item>
              ))}
            </Timeline>
          </Card>
        </TabPane>
      </Tabs>

      {/* Team Statistics */}
      {teamStats && (
        <Card title="Team Statistics" style={{ marginTop: "24px" }}>
          <Row gutter={[16, 16]}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Most Active Employee"
                  value={teamStats.mostActiveEmployee}
                  prefix={<UserOutlined />}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Most Active Repository"
                  value={teamStats.mostActiveRepository}
                  prefix={<BranchesOutlined />}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Average Commits per Employee"
                  value={teamStats.averageCommitsPerEmployee}
                  precision={2}
                  prefix={<BarChartOutlined />}
                />
              </Card>
            </Col>
          </Row>
        </Card>
      )}
    </div>
  );
}
