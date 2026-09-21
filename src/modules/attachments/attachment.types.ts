export interface AttachmentUser {
  id: string;
  name: string;
  email: string;
}

export interface AttachmentResponse {
  id: string;
  taskId: string;
  uploadedById: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date | string;
  uploadedBy?: AttachmentUser;
}
