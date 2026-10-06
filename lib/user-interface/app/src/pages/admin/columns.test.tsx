import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { getColumnDefinition, ColumnItem } from "./columns";

function renderRow(type: "detailedEvaluation" | "evaluationSummary", item: ColumnItem) {
  const columns = getColumnDefinition(type, () => {});
  const ids = ["answerQ", "retrievalQ", "responseQ", "actualResponse", "answerQuality", "retrievalQuality", "totalQuestions"];
  render(
    <table>
      <tbody>
        <tr>
          {columns
            .filter((col) => ids.includes(col.id))
            .map((col) => (
              <td key={col.id} data-testid={col.id}>
                {col.cell(item)}
              </td>
            ))}
        </tr>
      </tbody>
    </table>
  );
}

describe("evaluation columns", () => {
  it("renders a failed question with a Failed chip, its error, and no numeric scores", () => {
    renderRow("detailedEvaluation", { question: "q", failed: true, error: "Model timed out" });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByTestId("actualResponse")).toHaveTextContent("Model timed out");
    expect(screen.getByTestId("retrievalQ")).toHaveTextContent("n/a");
    expect(document.body.textContent).not.toMatch(/NaN|%/);
  });

  it("renders a 6-metric summary without relevance and shows absent groups as n/a", () => {
    renderRow("evaluationSummary", {
      EvaluationId: "e1",
      average_correctness: 0.5,
      average_similarity: 0.7,
      average_relevance: null,
      total_questions: 10,
      failed_questions: 2,
    });
    expect(screen.getByTestId("answerQuality")).toHaveTextContent("60%");
    expect(screen.getByTestId("retrievalQuality")).toHaveTextContent("n/a");
    expect(screen.getByTestId("totalQuestions")).toHaveTextContent("10 (2 failed)");
    expect(document.body.textContent).not.toContain("NaN");
  });
});
