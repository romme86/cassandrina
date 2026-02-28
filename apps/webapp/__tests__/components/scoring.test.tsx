/**
 * Jest/RTL tests for scoring-related display components.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// Simple inline component test (no DB dependency)
function ScoreDisplay({ accuracy, congruency }: { accuracy: number; congruency: number }) {
  const confidence = (accuracy + congruency) / 2;
  const strategy =
    confidence >= 65 ? "A" :
    confidence >= 55 ? "B" :
    confidence >= 45 ? "C" :
    confidence >= 35 ? "D" : "E";

  return (
    <div>
      <span data-testid="accuracy">{accuracy.toFixed(1)}%</span>
      <span data-testid="congruency">{congruency.toFixed(1)}%</span>
      <span data-testid="strategy">Strategy {strategy}</span>
    </div>
  );
}

describe("ScoreDisplay component", () => {
  test("renders accuracy and congruency", () => {
    render(<ScoreDisplay accuracy={72.5} congruency={63.0} />);
    expect(screen.getByTestId("accuracy")).toHaveTextContent("72.5%");
    expect(screen.getByTestId("congruency")).toHaveTextContent("63.0%");
  });

  test("shows Strategy A for high scores", () => {
    render(<ScoreDisplay accuracy={80} congruency={80} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy A");
  });

  test("shows Strategy E for low scores", () => {
    render(<ScoreDisplay accuracy={20} congruency={20} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy E");
  });

  test("shows Strategy C for mid-range scores", () => {
    render(<ScoreDisplay accuracy={50} congruency={48} />);
    expect(screen.getByTestId("strategy")).toHaveTextContent("Strategy C");
  });
});
