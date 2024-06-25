import { Editor } from "tldraw"

export type User = {
  id: string
  color: string
  name: string
}

export const getRoomMembers = (editor: Editor): User[] => {
  const collaborators = editor.getCollaboratorsOnCurrentPage()
  const user = editor.user.getUserPreferences()
  const roomMembers: User[] = collaborators.filter(user => user.userName !== "New User").map(u => {
    return {
      id: u.userId,
      name: u.userName,
      color: u.color
    }
  })
  roomMembers.push({
    id: user.id,
    name: user.name,
    color: user.color
  })
  return roomMembers
}

export const getCurrentUser = (editor: Editor): User => {
  const user = editor.user.getUserPreferences()
  return {
    id: user.id,
    name: user.name,
    color: user.color
  }
}

