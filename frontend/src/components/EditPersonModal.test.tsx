import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { Person } from '../types';
import { EditPersonModal } from './EditPersonModal';

const person: Person = {
  id: 'person-1',
  name: 'Alice',
  gender: 'F',
  dob: null,
  dod: null,
  avatar_url: null,
  avatars: [],
  metadata: null,
};

describe('EditPersonModal avatar upload', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:avatar-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('accepts mobile image files when Firefox does not report a MIME type', async () => {
    const onSubmit = vi.fn();

    render(
      <I18nProvider>
        <EditPersonModal
          person={person}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    );

    const file = new File(['phone image bytes'], 'phone-photo.jpg');
    const input = screen.getByLabelText('Choose photo');
    const inputClick = vi.spyOn(input as HTMLInputElement, 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByText('Drag photo here'));
    expect(inputClick).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2]).toBe(file);
    expect(screen.queryByText('Unsupported image format. Use JPG, PNG, or WebP.')).not.toBeInTheDocument();
  });

  it('does not render role selector even when canInvite and onInvite are enabled', () => {
    render(
      <I18nProvider>
        <EditPersonModal
          person={person}
          canInvite={true}
          onInvite={vi.fn()}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </I18nProvider>
    );

    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('角色')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /role/i })).not.toBeInTheDocument();
  });

  it('removes primary avatar when clicking remove primary button and submitting', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSubmit = vi.fn();
    const personWithAvatar: Person = {
      ...person,
      avatar_url: '/api/avatars/existing.png',
      avatars: [
        {
          id: 'avatar-1',
          person_id: 'person-1',
          avatar_url: '/api/avatars/existing.png',
          is_primary: true,
          sort_order: 0,
        },
      ],
    };

    render(
      <I18nProvider>
        <EditPersonModal
          person={personWithAvatar}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    );

    const removeBtn = screen.getByRole('button', { name: 'Remove primary avatar' });
    fireEvent.click(removeBtn);

    expect(screen.queryByRole('button', { name: 'Remove primary avatar' })).not.toBeInTheDocument();
    expect(screen.getByText('Primary avatar marked for removal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][3]).toBe(true); // removeAvatar
    expect(onSubmit.mock.calls[0][4]).toEqual({
      deleteAvatarIds: ['avatar-1'],
      setPrimaryAvatarId: null,
    });
  });

  it('adjusts birth year via stepper buttons', () => {
    const personWithDob: Person = {
      ...person,
      dob: '1990-05-12',
    };

    render(
      <I18nProvider>
        <EditPersonModal
          person={personWithDob}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </I18nProvider>
    );

    const yearInput = screen.getByPlaceholderText('Year') as HTMLInputElement;
    expect(yearInput.value).toBe('1990');

    const decreaseBtn = screen.getByTitle('Decrease year');
    const increaseBtn = screen.getByTitle('Increase year');

    fireEvent.click(decreaseBtn);
    expect(yearInput.value).toBe('1989');

    fireEvent.click(increaseBtn);
    fireEvent.click(increaseBtn);
    expect(yearInput.value).toBe('1991');
  });
});
