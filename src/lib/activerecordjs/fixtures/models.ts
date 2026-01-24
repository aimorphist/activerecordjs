import { Model } from '../model';
import { users, posts } from './schema';

export const User = Model(users);
export const Post = Model(posts);
