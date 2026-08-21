export interface SafeCommentUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface CommentResponse {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user: SafeCommentUser;
}
