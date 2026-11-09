// Shared counters for the verify-*.mjs scripts. Run `pnpm build` in packages/adapters first.
import { normalize, validateTrace } from "@tetraslam/kiseki-core";

export function createReport(name) {
  const totals = {
    files: 0,
    failed: 0,
    invalid: 0,
    issues: 0,
    steps: 0,
    calls: 0,
    paired: 0,
    unpaired: 0,
    errors: 0,
    patches: 0,
    diffs: 0,
    subagentSteps: 0,
    refs: 0,
  };
  const problems = [];
  return {
    totals,
    problems,
    /** Converts one source and validates the record; `expect` holds counts taken from the source. */
    check(label, convert, expect = {}) {
      totals.files++;
      let record;
      try {
        record = convert();
      } catch (error) {
        totals.failed++;
        problems.push(`${label}: threw ${error?.stack ?? error}`);
        return;
      }
      const { record: valid, issues } = validateTrace(record);
      if (!valid) totals.invalid++;
      totals.issues += issues.length;
      for (const issue of issues.slice(0, 3))
        problems.push(`${label}: ${issue.path} ${issue.message}`);
      if (!valid) return;
      const view = normalize(valid);
      const steps = valid.steps ?? [];
      totals.steps += steps.length;
      let calls = 0;
      for (const step of view.steps) {
        for (const call of step.calls) {
          calls++;
          if (call.observation) totals.paired++;
          else totals.unpaired++;
          if (call.observation?.error) totals.errors++;
        }
      }
      totals.calls += calls;
      totals.patches += valid.patches?.length ?? 0;
      totals.diffs += (valid.patches ?? []).filter((patch) => patch.diff).length;
      totals.subagentSteps += steps.filter((step) => step.call_type === "subagent").length;
      totals.refs += steps.filter((step) => step.subagent_trajectory_ref).length;
      for (const step of steps) {
        for (const o of step.observations ?? []) {
          if ((o.output_summary?.length ?? 0) > 200) problems.push(`${label}: long summary`);
        }
      }
      if (expect.calls != null && expect.calls !== calls) {
        problems.push(`${label}: source has ${expect.calls} calls, record has ${calls}`);
      }
      if (expect.results != null) {
        const observed = steps.reduce((n, step) => n + (step.observations?.length ?? 0), 0);
        if (expect.results !== observed) {
          problems.push(`${label}: source has ${expect.results} results, record has ${observed}`);
        }
      }
      return valid;
    },
    print() {
      console.log(`${name}:`, totals);
      if (problems.length)
        console.log(`${problems.length} problems:\n  ${problems.slice(0, 40).join("\n  ")}`);
    },
  };
}
