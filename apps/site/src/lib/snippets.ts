/** The custom renderer from components/package-cards.tsx, trimmed for the page. */
export const packageRendererSource = `import { Trace, type ToolRendererProps } from "@tetraslam/kiseki";

function PackageCard(props: ToolRendererProps) {
  const details = parse(props.payload ?? props.observation?.content);
  if (!details) return <props.Default {...props} />; // kiseki's own view
  return <Card name={details.name} downloads={details.weeklyDownloads} … />;
}

<Trace
  record={record}
  renderers={{ tools: { searchPackages: SearchResults, packageDetails: PackageCard } }}
/>`;
