import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const getOptions = vi.fn();
let canManagePeople = true;

vi.mock('@/app/trips/apis', () => ({
  getLoadingSupervisorOptions: (id: string) => getOptions(id),
}));
vi.mock('@/lib/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ui')>();
  return { ...real, useCan: () => (p: string) => p === 'config.manage' && canManagePeople };
});

import { LoadingSupervisorDialog } from './loading-supervisor-dialog';

const renderDialog = (onAssign = vi.fn()) =>
  render(
    <LoadingSupervisorDialog
      open
      tripId="t-1"
      currentId={null}
      body="Runs the loading."
      onAssign={onAssign}
      onClose={() => {}}
    />,
  );

describe('LoadingSupervisorDialog', () => {
  beforeEach(() => {
    getOptions.mockReset();
    canManagePeople = true;
  });

  it('lists the supervisors and assigns the one chosen', async () => {
    getOptions.mockResolvedValue([{ id: 'u-1', name: 'Ravi Kumar', branchId: null }]);
    const onAssign = vi.fn();
    renderDialog(onAssign);
    await screen.findByRole('option', { name: 'Ravi Kumar' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onAssign).toHaveBeenCalledWith('u-1');
  });

  it('says nobody is set up yet, and where to add them, instead of an empty list', async () => {
    getOptions.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText('No loading supervisor set up yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People and access' })).toHaveAttribute('href', '/admin/users');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('tells someone who cannot add people to ask an administrator', async () => {
    canManagePeople = false;
    getOptions.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/Ask an administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'People and access' })).toBeNull();
  });

  it('shows why the list could not be loaded', async () => {
    getOptions.mockRejectedValue(new Error('Network down'));
    renderDialog();
    expect(await screen.findByText('Could not load the loading supervisors')).toBeInTheDocument();
  });
});
