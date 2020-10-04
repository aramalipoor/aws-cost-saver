import { TrickContext } from './trick-context';

export type RootContext = {
  [trickName: string]: TrickContext;
};
