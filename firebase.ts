import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, doc, addDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, deleteDoc, limit } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

// Auth Helpers
export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);
export { onAuthStateChanged };

// Firestore Helpers
export {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  limit
};
