import { Model } from '../model';
import { usersTable, postsTable, commentsTable, profilesTable, tagsTable } from './schema';

class UserModel extends Model(usersTable) {
	static hasOne = {
		profile: { model: () => ProfileModel }
	};
	static hasMany = {
		posts: { model: () => PostModel },
		comments: { model: () => CommentModel, through: 'posts' }
	};
}

class PostModel extends Model(postsTable) {
	static belongsTo = {
		user: { model: () => UserModel }
	};
	static hasMany = {
		comments: { model: () => CommentModel }
	};
	static hasAndBelongsToMany = {
		tags: { model: () => TagModel }
	};
}

class CommentModel extends Model(commentsTable) {
	static belongsTo = {
		post: { model: () => PostModel },
		user: { model: () => UserModel }
	};
}

class ProfileModel extends Model(profilesTable) {
	static belongsTo = {
		user: { model: () => UserModel }
	};
}

class TagModel extends Model(tagsTable) {}

export const User = UserModel;
export const Post = PostModel;
export const Comment = CommentModel;
export const Profile = ProfileModel;
export const Tag = TagModel;
