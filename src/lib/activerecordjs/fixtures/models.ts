import { Model } from '../model';
import { usersTable, postsTable, commentsTable } from './schema';

class UserModel extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => PostModel },
		comments: { model: () => CommentModel }
	};
}

class PostModel extends Model(postsTable) {
	static belongsTo = {
		user: { model: () => UserModel }
	};
	static hasMany = {
		comments: { model: () => CommentModel }
	};
}

class CommentModel extends Model(commentsTable) {
	static belongsTo = {
		post: { model: () => PostModel },
		user: { model: () => UserModel }
	};
}

export const User = UserModel;
export const Post = PostModel;
export const Comment = CommentModel;
