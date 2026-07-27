export type ReversibleAction = {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};
