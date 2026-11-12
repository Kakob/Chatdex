import { describe, expect, it } from 'vitest';
import { addTask, clearCompleted, initialTodoState, removeTask, renameTask, todoTransition, toggleTask } from './todoModel';

describe('Todo engineering example', () => {
  it('adds real task state and toggles completion without removing it', () => {
    const initial = initialTodoState();
    const added = addTask(initial, '  Read queue code  ');
    expect(initial.items).toEqual([]); // immutable
    expect(added.items).toEqual([{ id: 'todo-1', title: 'Read queue code', completed: false, createdAtStep: 1 }]);
    const finished = toggleTask(added, 'todo-1');
    expect(finished.items[0].completed).toBe(true);
    expect(toggleTask(finished, 'todo-1').items[0].completed).toBe(false);
  });

  it('renames, removes and clears completed tasks with stable IDs', () => {
    const a = todoTransition(initialTodoState(), { type: 'add', title: 'one' });
    const b = todoTransition(a, { type: 'add', title: 'two' });
    expect(renameTask(b, 'todo-2', '  new name  ').items[1].title).toBe('new name');
    const done = toggleTask(b, 'todo-1');
    expect(clearCompleted(done).items.map((x) => x.id)).toEqual(['todo-2']);
    expect(removeTask(done, 'todo-2').items.map((x) => x.id)).toEqual(['todo-1']);
    expect(clearCompleted(b)).toBe(b);
    expect(removeTask(b, 'missing')).toBe(b);
    expect(addTask(b, '  ')).toBe(b);
  });
});
