/**
 * A small real program for the Todo List engineering example. The UI below
 * calls these pure functions; the inspector displays this exact source file.
 * All changes are local to the running example until an explicit persistence
 * capability is designed. A task that is "done" is not deleted.
 */
export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAtStep: number;
}

export interface TodoState {
  items: TodoItem[];
  nextId: number;
  step: number;
}

export type TodoAction =
  | { type: 'add'; title: string }
  | { type: 'toggle'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'remove'; id: string }
  | { type: 'clear-completed' };

export function initialTodoState(): TodoState {
  return { items: [], nextId: 1, step: 0 };
}

export function addTask(state: TodoState, title: string): TodoState {
  const cleaned = title.trim();
  if (!cleaned) return state;
  return {
    ...state,
    items: [...state.items, { id: 'todo-' + state.nextId, title: cleaned, completed: false, createdAtStep: state.step + 1 }],
    nextId: state.nextId + 1,
    step: state.step + 1,
  };
}

export function toggleTask(state: TodoState, id: string): TodoState {
  const exists = state.items.some((task) => task.id === id);
  if (!exists) return state;
  return {
    ...state,
    items: state.items.map((task) => task.id === id ? { ...task, completed: !task.completed } : task),
    step: state.step + 1,
  };
}

export function renameTask(state: TodoState, id: string, title: string): TodoState {
  const cleaned = title.trim();
  if (!cleaned || !state.items.some((task) => task.id === id)) return state;
  return {
    ...state,
    items: state.items.map((task) => task.id === id ? { ...task, title: cleaned } : task),
    step: state.step + 1,
  };
}

export function removeTask(state: TodoState, id: string): TodoState {
  if (!state.items.some((task) => task.id === id)) return state;
  return { ...state, items: state.items.filter((task) => task.id !== id), step: state.step + 1 };
}

export function clearCompleted(state: TodoState): TodoState {
  const remaining = state.items.filter((task) => !task.completed);
  if (remaining.length === state.items.length) return state;
  return { ...state, items: remaining, step: state.step + 1 };
}

export function todoTransition(state: TodoState, action: TodoAction): TodoState {
  switch (action.type) {
    case 'add': return addTask(state, action.title);
    case 'toggle': return toggleTask(state, action.id);
    case 'rename': return renameTask(state, action.id, action.title);
    case 'remove': return removeTask(state, action.id);
    case 'clear-completed': return clearCompleted(state);
  }
}
