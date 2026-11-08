import { builder } from './builder';
import './types';
import './operations';

export const schema = builder.toSchema();
