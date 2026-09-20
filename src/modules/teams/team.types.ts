export interface TeamMemberResponse {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export interface TeamResponse {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  members?: TeamMemberResponse[];
  _count?: {
    members: number;
    tasks: number;
  };
}
