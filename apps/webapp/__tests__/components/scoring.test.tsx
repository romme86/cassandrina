/**
 * Jest/RTL tests for scoring-related display components.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// Simple inline component test (no DB dependency)
function ScoreDisplay({ accuracy, congruency }: { accuracy: number; congruency: number }) {
  const confidence = (accuracy + congruency) / 2;
  const strategy =
    confidence >= 0.65 ? "A" :
    confidence >= 0.55 ? "B" :
    confidence >= 0.45 ? "C" :
    confidence >= 0.35 ? "D" : "E";

  return (
    <div>
      <span data-testid="accuracy">{(accuracy * 100).toFixed(1)}%</span>
      <span data-testid="congruency">{(congruency * 100).toFixed(1)}%</span>
      <span data-testid="strategy">Strategy {strategy}</span>
    </div>
  );
}

describe("ScoreDisplay component", () => {
  test("renders accuracy and congruency", () => {
    render(<ScoreDisplay accuracy={0.725} congruency={0.63} />);
    expect(screen.getByTestId("accuracy")).toHaveTextContent("72.5%");
    expect(screen.getByTestId("congruency")).toHaveTextContent("63.0%");
  });

  test("shows Strategy A for high scores", () => {
    render(<ScoreDisplay accuracy={0.8} congruency={0.8} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy A");
  });

  test("shows Strategy E for low scores", () => {
    render(<ScoreDisplay accuracy={0.2} congruency={0.2} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy E");
  });

  test("shows Strategy C for mid-range scores", () => {
    render(<ScoreDisplay accuracy={0.5} congruency={0.48} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy C");
  });
});
