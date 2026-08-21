import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Tag,
  Panel,
  Banner,
  StatStrip,
  FactList,
  DataTable,
  Column,
  Field,
  BlockedPanel,
  Dialog,
  Loading,
  ErrorState,
} from './ui';

describe('Tag', () => {
  it('renders its children', () => {
    render(<Tag tone="mint">ACTIVE</Tag>);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });
  it('defaults to the grey tone when none is given', () => {
    render(<Tag>PLAIN</Tag>);
    const el = screen.getByText('PLAIN');
    expect(el.style.color).toBe('var(--grey)');
  });
});

describe('Panel', () => {
  it('renders a title and body content', () => {
    render(<Panel title="Trips pending allocation">body content</Panel>);
    expect(screen.getByText('Trips pending allocation')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });
  it('renders without a title when none is given', () => {
    render(<Panel>just body</Panel>);
    expect(screen.getByText('just body')).toBeInTheDocument();
  });
  it('renders the `right` slot alongside the title', () => {
    render(
      <Panel title="POD overdue" right={<span>Export CSV</span>}>
        content
      </Panel>,
    );
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});

describe('Banner', () => {
  it('renders title and children for a given tone', () => {
    render(
      <Banner tone="red" title="Blocked">
        3 documents missing
      </Banner>,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('3 documents missing')).toBeInTheDocument();
  });
});

describe('StatStrip', () => {
  it('renders every stat key and value', () => {
    render(
      <StatStrip
        stats={[
          { k: 'Waiting', v: 3 },
          { k: 'Freight at stake', v: '₹1.4 L', tone: 'red' },
        ]}
      />,
    );
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Freight at stake')).toBeInTheDocument();
    expect(screen.getByText('₹1.4 L')).toBeInTheDocument();
  });
  it('renders an optional note under a stat', () => {
    render(<StatStrip stats={[{ k: 'Tonnes', v: 60, note: 'across 3 branches' }]} />);
    expect(screen.getByText('across 3 branches')).toBeInTheDocument();
  });
});

describe('FactList', () => {
  it('renders each key/value pair as a row', () => {
    render(
      <FactList
        facts={[
          ['Vendor', 'Rathod Roadlines'],
          ['Fleet', '14'],
        ]}
      />,
    );
    expect(screen.getByText('Vendor')).toBeInTheDocument();
    expect(screen.getByText('Rathod Roadlines')).toBeInTheDocument();
    expect(screen.getByText('Fleet')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });
});

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: 'id', label: 'ID', render: (r) => r.id },
  { key: 'name', label: 'Name', render: (r) => r.name },
];

describe('DataTable', () => {
  it('renders a header and a row per item', () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
  it('shows the empty message and no table when rows is empty', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('sets data-label on every cell for the mobile card-collapse breakpoint', () => {
    render(<DataTable columns={columns} rows={[{ id: '1', name: 'Alpha' }]} rowKey={(r) => r.id} />);
    const cells = screen.getAllByText(/Alpha|1/);
    for (const cell of cells) {
      expect(cell.closest('td')).toHaveAttribute('data-label');
    }
  });
  it('fires onRowClick with the clicked row when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[{ id: '1', name: 'Alpha' }]}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alpha').closest('tr')!);
    expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Alpha' });
  });
});

describe('Field', () => {
  it('renders a label and marks required fields', () => {
    render(
      <Field label="Pickup city" required>
        <input />
      </Field>,
    );
    expect(screen.getByText('Pickup city')).toHaveClass('req');
  });
  it('shows an error message instead of the hint when both are given', () => {
    render(
      <Field label="Weight" hint="in metric tonnes" error="Required">
        <input />
      </Field>,
    );
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('in metric tonnes')).not.toBeInTheDocument();
  });
  it('shows the hint when there is no error', () => {
    render(
      <Field label="Weight" hint="in metric tonnes">
        <input />
      </Field>,
    );
    expect(screen.getByText('in metric tonnes')).toBeInTheDocument();
  });
});

describe('BlockedPanel', () => {
  it('lists unmet conditions and shows the blocked (red) tone', () => {
    render(
      <BlockedPanel
        title="Advance"
        unmet={[{ key: 'dl', label: 'Driving licence not on file', state: 'MISSING' }]}
      />,
    );
    expect(screen.getByText(/🔒 Advance/)).toBeInTheDocument();
    expect(screen.getByText('Driving licence not on file')).toBeInTheDocument();
    expect(screen.getByText('not uploaded')).toBeInTheDocument();
  });
  it('shows no lock icon and lists cleared conditions when nothing is unmet', () => {
    render(<BlockedPanel title="Advance" unmet={[]} cleared={[{ key: 'dl', label: 'Driving licence' }]} />);
    expect(screen.getByText('Advance')).toBeInTheDocument();
    expect(screen.queryByText(/🔒/)).not.toBeInTheDocument();
    expect(screen.getByText('Driving licence')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="Confirm" confirmLabel="OK" onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });
  it('renders title and calls onConfirm/onClose from their buttons', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Dialog open title="Release balance?" confirmLabel="Release" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByText('Release'));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
  it('disables the confirm button while busy and shows a working label', () => {
    render(<Dialog open title="Release" confirmLabel="Release" busy onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Working…')).toBeDisabled();
  });
});

describe('Loading / ErrorState', () => {
  it('Loading shows the given label', () => {
    render(<Loading what="Loading your queues" />);
    expect(screen.getByText(/Loading your queues/)).toBeInTheDocument();
  });
  it('ErrorState shows the message and calls retry when clicked', () => {
    const retry = vi.fn();
    render(<ErrorState message="Network error" retry={retry} />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
  it('ErrorState renders no retry button when retry is not given', () => {
    render(<ErrorState message="Network error" />);
    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
  });
});
