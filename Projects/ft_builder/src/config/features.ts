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
    key: "ft-runner",
    name: "FT Runner",
    description:
      "Run functional tests against your codebase with automated test execution, result tracking, and detailed reporting.",
    icon: "PlayCircleOutlined",
    route: "/features/ft-runner",
    color: "#52c41a",
    status: "active",
  },
  {
    key: "ft-builder",
    name: "Auto FT Builder",
    description:
      "Automatically generate functional tests from your code using AI. Analyze code paths and produce comprehensive test suites.",
    icon: "BuildOutlined",
    route: "/ftbuilder",
    color: "#722ed1",
    status: "active",
  },
];

export function getFeatureByKey(key: string): FeatureConfig | undefined {
  return features.find((f) => f.key === key);
}

export function getActiveFeatures(): FeatureConfig[] {
  return features.filter((f) => f.status === "active");
}
