import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagBadge } from './TagBadge';

describe('TagBadge', () => {
  it('renders tag name', () => {
    render(<TagBadge name="react" />);
    expect(screen.getByText('react')).toBeInTheDocument();
  });

  it('renders remove button when onRemove provided', () => {
    const onRemove = vi.fn();
    render(<TagBadge name="react" onRemove={onRemove} />);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('does not render remove button when onRemove absent', () => {
    render(<TagBadge name="react" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clicking remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(<TagBadge name="react" onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('remove button click stops event propagation', () => {
    const onRemove = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <TagBadge name="react" onRemove={onRemove} />
      </div>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onRemove).toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
