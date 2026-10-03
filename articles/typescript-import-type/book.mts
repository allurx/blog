console.log('book module evaluated');

export interface Book {
  readonly id: number;
}

export function createBook(id: number): Book {
  return { id };
}
