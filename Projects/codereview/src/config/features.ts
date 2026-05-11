export interface FeatureConfig {
  key: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  color: string;
  status: "active" | "coming-soon";
}

export const features: FeatureConfig[] = [
  {
    key: "review-sparkx",
    name: "Code Review",
    description:
      "AI-powered code reviews for pull requests and commits. Get detailed analysis with quality scores, best practices, and actionable suggestions.",
    icon: "CodeOutlined",
    route: "/features/review-sparkx",
    color: "#1677ff",
    status: "active",
  },
];

export function getFeatureByKey(key: string): FeatureConfig | undefined {
  return features.find((f) => f.key === key);
}

export function getActiveFeatures(): FeatureConfig[] {
  return features.filter((f) => f.status === "active");
}
