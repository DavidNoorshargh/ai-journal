import { useLocalSearchParams } from "expo-router";

import { EditorScreen } from "@/screens/editor-screen";

export default function NoteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const noteId = Array.isArray(id) ? id[0] : id;
  return <EditorScreen mode="edit" noteId={noteId} />;
}
