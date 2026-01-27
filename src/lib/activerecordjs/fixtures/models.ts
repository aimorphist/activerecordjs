import { Model } from '../model';
import { usersTable, postsTable } from './schema';

export const User = Model(usersTable);
export const Post = Model(postsTable);
