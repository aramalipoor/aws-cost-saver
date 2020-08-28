import Listr, { ListrTaskWrapper } from 'listr';

import { TrickOptionsInterface } from './trick-options.interface';

export interface TrickInterface<StateType> {
  getMachineName(): string;
  getConserveTitle(): string;
  getRestoreTitle(): string;

  getCurrentState(
    task: ListrTaskWrapper,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
  conserve(
    task: ListrTaskWrapper,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
  restore(
    task: ListrTaskWrapper,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
}
