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
});
