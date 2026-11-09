import { PackageCard, SearchResults } from "@/components/package-cards";

/** The package scout demo's renderers; kiseki's built-ins render every other tool. */
export const packageRenderers = {
  tools: { searchPackages: SearchResults, packageDetails: PackageCard },
};
