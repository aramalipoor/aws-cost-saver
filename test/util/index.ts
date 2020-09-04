import { Listr, ListrTask } from 'listr2';
import { Writable } from 'stream';

export function createMockTask() {
  return {
    output: '',
    title: '',
    newListr(tasks: ListrTask[], options: any) {
      return new Listr(tasks, { renderer: 'silent', ...options });
    },
    prompt: jest.fn(),
    report: jest.fn(),
    run: jest.fn(),
    skip: jest.fn(),
    stdout(): NodeJS.WritableStream {
      const stream = new Writable();
      stream._write = function(chunk, encoding, callback) {
        /* do nothing */
      };

      return stream;
    },
  };
}
