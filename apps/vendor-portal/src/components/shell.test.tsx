import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pill, Callout, Facts, Segmented, ErrorNote } from './shell';

describe('Pill', () => {
  it('renders its children', () => {
    render(<Pill tone="mint">Available</Pill>);
    expect(screen.getByText('Available')).toBeInTheDocument();
  });
});

describe('Callout', () => {
  it('renders a title and optional body', () => {
    render(
      <Callout tone="red" title="POD rejected">
        Electricity bill is more than three months old.
      </Callout>,
    );
    expect(screen.getByText('POD rejected')).toBeInTheDocument();
    expect(screen.getByText(/Electricity bill/)).toBeInTheDocument();
  });
  it('renders without body content when none is given', () => {
    render(<Callout tone="mint" title="All clear" />);
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });
});

describe('Facts', () => {
  it('renders every key/value row', () => {
    render(
      <Facts
        rows={[
          ['Advance held', '₹23,360'],
          ['Documents blocking', '3'],
        ]}
      />,
    );
    expect(screen.getByText('Advance held')).toBeInTheDocument();
    expect(screen.getByText('₹23,360')).toBeInTheDocument();
    expect(screen.getByText('Documents blocking')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('Segmented', () => {
  it('renders every option and calls onChange with the clicked one', () => {
    const onChange = vi.fn();
    render(<Segmented options={['All', 'Open', 'Won', 'Lost'] as const} value="All" onChange={onChange} />);
    expect(screen.getByText('Open')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Won'));
    expect(onChange).toHaveBeenCalledWith('Won');
  });
});

describe('ErrorNote', () => {
  it('renders the error message as a red callout', () => {
    render(<ErrorNote message="Request failed with status code 404" />);
    expect(screen.getByText('Request failed with status code 404')).toBeInTheDocument();
  });
});
