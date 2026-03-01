import React from "react";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar";

const mockPathname = jest.fn(() => "/");

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

jest.mock("next/link", () => {
  const Link = ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
  Link.displayName = "Link";
  return Link;
});

describe("Sidebar", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/");
  });

  it("renders all nav items", () => {
    render(<Sidebar tradingEnabled={false} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Predictions")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Wallet")).toBeInTheDocument();
  });

  it("highlights Dashboard link when on root path", () => {
    mockPathname.mockReturnValue("/");
    render(<Sidebar tradingEnabled={false} />);
    const dashLink = screen.getByText("Dashboard").closest("a");
    expect(dashLink?.className).toMatch(/text-primary/);
  });

  it("highlights Leaderboard link when on /users path", () => {
    mockPathname.mockReturnValue("/users");
    render(<Sidebar tradingEnabled={false} />);
    const link = screen.getByText("Leaderboard").closest("a");
    expect(link?.className).toMatch(/text-primary/);
  });

  it("shows Live status when trading is enabled", () => {
    render(<Sidebar tradingEnabled={true} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows Paused status when trading is disabled", () => {
    render(<Sidebar tradingEnabled={false} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("renders brand name", () => {
    render(<Sidebar tradingEnabled={false} />);
    expect(screen.getByText("Cassandrina")).toBeInTheDocument();
  });
});
