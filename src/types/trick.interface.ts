import { Listr, ListrTaskWrapper } from 'listr2';

import { TrickOptionsInterface } from './trick-options.interface';
import { TrickContext } from './trick-context';

export interface TrickInterface<StateType> {
  getMachineName(): string;
  prepareTags(
    context: TrickContext,
    task: ListrTaskWrapper<any, any>,
    options: TrickOptionsInterface,
  ): Promise<Listr | void>;
  getCurrentState(
    context: TrickContext,
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
