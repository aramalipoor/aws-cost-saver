import { Listr, ListrTaskWrapper } from 'listr2';

import { TrickOptionsInterface } from './trick-options.interface';
import { TrickContext } from './trick-context';

export interface TrickInterface<StateType> {
  getMachineName(): string;

  prepareTags(
    task: ListrTaskWrapper<any, any>,
    context: TrickContext,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;

  getCurrentState(
    task: ListrTaskWrapper<any, any>,
    context: TrickContext,
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
