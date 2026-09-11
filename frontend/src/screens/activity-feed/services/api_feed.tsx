import client from "../../../auth/api-client/api_client"; // Adjust path as needed

const endpoint = '/feed';

// Post APIs
// Inside api_feed.ts
const GetFeed = (tab: string, page: number = 1, limit: number = 10) => {
  return client.get(`${endpoint}?tab=${tab}&page=${page}&limit=${limit}`);
};
const GetUserPosts = (userId: string) => client.get<any>(`${endpoint}/user/${userId}/posts`);
const ToggleLikePost = (postId: string) => client.post(`${endpoint}/post/${postId}/like`);
const DeletePost = (postId: string) => client.delete(`${endpoint}/post/${postId}`);

// Comment APIs
const GetComments = (postId: string) => client.get(`${endpoint}/post/${postId}/comments`);
const AddComment = (postId: string, data: { text: string; parentId?: string | null }) => 
    client.post(`${endpoint}/post/${postId}/comments`, data);
const DeleteComment = (commentId: string) => client.delete(`${endpoint}/comment/${commentId}`);
const ToggleLikeComment = (commentId: string) => client.post(`${endpoint}/comment/${commentId}/like`);

export default {
    GetFeed,
    GetUserPosts,
    ToggleLikePost,
    DeletePost,
    GetComments,
    AddComment,
    DeleteComment,
    ToggleLikeComment
};