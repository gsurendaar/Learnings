"use client";

import { useState, useEffect } from "react";
import {
  Layout,
  Card,
  Table,
  Input,
  Button,
  Space,
  Typography,
  message,
  Spin,
  Empty,
  Tag,
  Tooltip,
  Modal,
} from "antd";
import {
  SearchOutlined,
  FileTextOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { ModernHeader } from "@/components/ModernHeader";
import { SubHeader } from "@/components/SubHeader";
import { useTheme } from "@/components/ThemeProvider";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

const { Content } = Layout;
const { Title, Text } = Typography;

interface TrackingEntry {
  id: number;
  username: string;
  pr_number: number | null;
  commit_id: string | null;
  model_name: string;
  submission_date: string;
  review_score: number | null;
  files_scanned: number | null;
  report_location: string | null;
}

interface ReviewData {
  metadata: {
    title: string;
    author: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    identifier: string;
    generatedAt: string;
  };
  review: {
    summary: string;
    codeQuality: {
      score: number;
      findings: string[];
    };
    bestPractices: {
      score: number;
      findings: string[];
    };
    maintainability: {
      score: number;
      findings: string[];
    };
    impactAnalysis: {
      score: number;
      findings: string[];
    };
    suggestions: string[];
    detailedAnalysis: string;
  };
  customInstructions: string;
}

export default function ReportsPage() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [trackingData, setTrackingData] = useState<TrackingEntry[]>([]);
  const [filteredData, setFilteredData] = useState<TrackingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [selectedReport, setSelectedReport] = useState<ReviewData | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    fetchTrackingData();
  }, []);

  // Filter data whenever search or data changes
  useEffect(() => {
    if (searchUsername.trim()) {
      setFilteredData(
        trackingData.filter((entry) =>
          entry.username.toLowerCase().includes(searchUsername.toLowerCase())
        )
      );
    } else {
      setFilteredData(trackingData);
    }
  }, [searchUsername, trackingData]);

  const fetchTrackingData = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/review-sparkx/tracking");
      const data = await response.json();

      if (data.success && data.data) {
        // Sort by submission_date descending
        const sorted = data.data.sort(
          (a: TrackingEntry, b: TrackingEntry) =>
            new Date(b.submission_date).getTime() -
            new Date(a.submission_date).getTime()
        );
        setTrackingData(sorted);
      } else {
        message.error("Failed to fetch tracking data");
      }
    } catch (error) {
      console.error("Error fetching tracking data:", error);
      message.error("Failed to load tracking data");
    } finally {
      setLoading(false);
    }
  };

  const loadReportDetails = async (reportLocation: string) => {
    if (!reportLocation) {
      message.error("Report location not available");
      return;
    }

    setLoadingReport(true);
    try {
      // Fetch the report file - assuming it's stored in public/reports/
      const fileName = reportLocation.split("/").pop();
      const response = await fetch(`/api/review-sparkx/reports/${fileName}`);
      const data = await response.json();

      if (data.success && data.report) {
        setSelectedReport(data.report);
        setReportModalVisible(true);
      } else {
        message.error("Failed to load report details");
      }
    } catch (error) {
      console.error("Error loading report:", error);
      message.error("Failed to load report");
    } finally {
      setLoadingReport(false);
    }
  };

  const columns = [
    {
      title: "Username",
      dataIndex: "username",
      key: "username",
      width: 150,
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: "Type",
      dataIndex: ["pr_number", "commit_id"],
      key: "type",
      width: 120,
      render: (_: any, record: TrackingEntry) => {
        if (record.pr_number) {
          return (
            <Tag color="blue">
              PR #{record.pr_number}
            </Tag>
          );
        } else if (record.commit_id) {
          return (
            <Tag color="green">
              {record.commit_id.substring(0, 8)}...
            </Tag>
          );
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: "Model",
      dataIndex: "model_name",
      key: "model_name",
      width: 180,
      render: (text: string) => (
        <Tooltip title={text}>
          <span>{text.length > 20 ? text.substring(0, 20) + "..." : text}</span>
        </Tooltip>
      ),
    },
    {
      title: "Submitted",
      dataIndex: "submission_date",
      key: "submission_date",
      width: 160,
      render: (date: string) => (
        <Text type="secondary">
          {new Date(date).toLocaleDateString()} {new Date(date).toLocaleTimeString()}
        </Text>
      ),
      sorter: (a: TrackingEntry, b: TrackingEntry) =>
        new Date(b.submission_date).getTime() -
        new Date(a.submission_date).getTime(),
    },
    {
      title: "Score",
      dataIndex: "review_score",
      key: "review_score",
      width: 80,
      render: (score: number | null) => {
        if (score === null) return <Text type="secondary">-</Text>;
        return (
          <span style={{
            color: score >= 8 ? "#52c41a" : score >= 6 ? "#faad14" : "#f5222d",
            fontWeight: 600,
          }}>
            {score.toFixed(2)}
          </span>
        );
      },
      sorter: (a: TrackingEntry, b: TrackingEntry) =>
        (a.review_score || 0) - (b.review_score || 0),
    },
    {
      title: "Files",
      dataIndex: "files_scanned",
      key: "files_scanned",
      width: 70,
      render: (count: number | null) => count || <Text type="secondary">-</Text>,
    },
    {
      title: "Report",
      key: "report",
      width: 120,
      render: (_: any, record: TrackingEntry) => (
        <Button
          type="primary"
          size="small"
          icon={<FileTextOutlined />}
          disabled={!record.report_location}
          loading={loadingReport}
          onClick={() => loadReportDetails(record.report_location!)}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh", background: isDark ? "#1f2937" : "#f5f5f5" }}>
      <ModernHeader />
      <SubHeader />

      <Content style={{ padding: "24px" }}>
        <Card
          style={{
            background: isDark ? "#2d3748" : "#ffffff",
            borderColor: isDark ? "#374151" : "#d9d9d9",
          }}
        >
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {/* Header with Title and Back Button */}
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Title level={2} style={{ margin: 0 }}>
                <FileTextOutlined /> Review Reports
              </Title>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => router.push("/features/review-sparkx")}
              >
                Back to Review
              </Button>
            </Space>

            {/* Search Bar */}
            <Space style={{ width: "100%" }}>
              <Input
                placeholder="Search by username..."
                prefix={<SearchOutlined />}
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                style={{ width: 300 }}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchTrackingData}
                loading={loading}
              >
                Refresh
              </Button>
              <Text type="secondary">
                {filteredData.length} of {trackingData.length} reports
              </Text>
            </Space>

            {/* Table */}
            {loading ? (
              <Spin size="large" style={{ width: "100%", padding: "50px 0" }} />
            ) : trackingData.length === 0 ? (
              <Empty
                description="No reports found"
                style={{ padding: "50px 0" }}
              />
            ) : (
              <Table
                columns={columns}
                dataSource={filteredData}
                rowKey="id"
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  showTotal: (total) => `Total ${total} reports`,
                }}
                style={{
                  backgroundColor: isDark ? "#374151" : "#fafafa",
                }}
              />
            )}
          </Space>
        </Card>
      </Content>

      {/* Report Details Modal */}
      <Modal
        title={
          selectedReport
            ? `Report: ${selectedReport.metadata?.identifier || "Unknown"}`
            : "Report Details"
        }
        open={reportModalVisible}
        onCancel={() => setReportModalVisible(false)}
        width="90vw"
        style={{ maxWidth: 1200 }}
        footer={[
          <Button key="close" onClick={() => setReportModalVisible(false)}>
            Close
          </Button>,
        ]}
      >
        {selectedReport ? (
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {/* Metadata Section */}
            <Card size="small" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                <Text>
                  <strong>Title:</strong> {selectedReport.metadata?.title}
                </Text>
                <Text>
                  <strong>Author:</strong> {selectedReport.metadata?.author}
                </Text>
                <Text>
                  <strong>Files Changed:</strong> {selectedReport.metadata?.filesChanged}
                </Text>
                <Text>
                  <strong>Additions/Deletions:</strong> +
                  {selectedReport.metadata?.additions} / -
                  {selectedReport.metadata?.deletions}
                </Text>
              </Space>
            </Card>

            {/* Review Section */}
            {selectedReport.review && (
              <Card size="small">
                <Space direction="vertical" style={{ width: "100%" }} size="middle">
                  {/* Summary */}
                  <div>
                    <Title level={4}>Summary</Title>
                    <ReactMarkdown>{selectedReport.review.summary}</ReactMarkdown>
                  </div>

                  {/* Scores */}
                  <div>
                    <Title level={4}>Scores</Title>
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Text>
                        Code Quality: {selectedReport.review.codeQuality?.score.toFixed(2)}/10
                      </Text>
                      <Text>
                        Best Practices: {selectedReport.review.bestPractices?.score.toFixed(2)}/10
                      </Text>
                      <Text>
                        Maintainability: {selectedReport.review.maintainability?.score.toFixed(2)}/10
                      </Text>
                      <Text>
                        Impact Analysis: {selectedReport.review.impactAnalysis?.score.toFixed(2)}/10
                      </Text>
                    </Space>
                  </div>

                  {/* Detailed Analysis */}
                  {selectedReport.review.detailedAnalysis && (
                    <div>
                      <Title level={4}>Detailed Analysis</Title>
                      <ReactMarkdown>{selectedReport.review.detailedAnalysis}</ReactMarkdown>
                    </div>
                  )}

                  {/* Suggestions */}
                  {selectedReport.review.suggestions?.length > 0 && (
                    <div>
                      <Title level={4}>Suggestions</Title>
                      <ul>
                        {selectedReport.review.suggestions.map((suggestion, idx) => (
                          <li key={idx}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Space>
              </Card>
            )}
          </div>
        ) : (
          <Spin />
        )}
      </Modal>
    </Layout>
  );
}
