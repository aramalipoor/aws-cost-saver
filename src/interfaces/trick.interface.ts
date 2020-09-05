import { Listr, ListrTaskWrapper } from 'listr2';

import { TrickOptionsInterface } from './trick-options.interface';

export interface TrickInterface<StateType> {
  getMachineName(): string;
  getCurrentState(
    task: ListrTaskWrapper<any, any>,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
  conserve(
    task: ListrTaskWrapper<any, any>,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
  restore(
    task: ListrTaskWrapper<any, any>,
    state: StateType,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
}
