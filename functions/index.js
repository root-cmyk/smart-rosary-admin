
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

const auth = getAuth();
const db = getFirestore();

const REGION = "us-central1";

function requireString(value, field, maxLength = 128) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength
  ) {
    throw new HttpsError(
      "invalid-argument",
      `Invalid ${field}.`
    );
  }

  return value.trim();
}

function validateEmail(email) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Please provide a valid email address."
    );
  }

  return email.trim().toLowerCase();
}

async function verifyAdmin(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in."
    );
  }

  const adminUid = request.auth.uid;
  const adminRef = db.collection("admins").doc(adminUid);
  const adminSnapshot = await adminRef.get();

  if (
    !adminSnapshot.exists ||
    adminSnapshot.data()?.enabled !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "You are not authorized to manage users."
    );
  }

  return adminUid;
}

async function protectAdminAccount(targetUid, callerUid) {
  if (targetUid === callerUid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot delete your own administrator account."
    );
  }

  const targetAdmin = await db
    .collection("admins")
    .doc(targetUid)
    .get();

  if (targetAdmin.exists && targetAdmin.data()?.enabled === true) {
    throw new HttpsError(
      "failed-precondition",
      "An enabled administrator account cannot be deleted here."
    );
  }
}

async function getAccountDocument(uid, expectedType) {
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "not-found",
      "The user profile does not exist."
    );
  }

  if (snapshot.data()?.accountType !== expectedType) {
    throw new HttpsError(
      "failed-precondition",
      "The account type does not match the requested operation."
    );
  }

  return userRef;
}

async function updateAccount(data) {
  const uid = requireString(data.uid, "user ID");
  const recordType = data.recordType;

  if (
    recordType !== "parent" &&
    recordType !== "independentChild"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Unsupported account type."
    );
  }

  const updates = data.updates || {};
  const name = requireString(updates.name, "name", 100);
  const email = validateEmail(updates.email);

  const username =
    typeof updates.username === "string"
      ? updates.username.trim().replace(/^@/, "").slice(0, 40)
      : "";

  const userRef = await getAccountDocument(uid, recordType);

  // Update Firebase Authentication first.
  try {
    await auth.updateUser(uid, {
      displayName: name,
      email,
    });
  } catch (error) {
    console.error("Firebase Auth update failed:", error);

    if (error.code === "auth/user-not-found") {
      throw new HttpsError(
        "not-found",
        "The Firebase Authentication account was not found."
      );
    }

    if (error.code === "auth/email-already-exists") {
      throw new HttpsError(
        "already-exists",
        "That email address is already being used by another account."
      );
    }

    if (error.code === "auth/invalid-email") {
      throw new HttpsError(
        "invalid-argument",
        "The email address is invalid."
      );
    }

    throw new HttpsError(
      "internal",
      "Unable to update the Firebase Authentication account."
    );
  }

  // Keep the Firestore profile synchronized.
  await userRef.update({
    name,
    displayName: name,
    email,
    username,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: "Account updated successfully.",
  };
}

async function updateManagedChild(data) {
  const parentUid = requireString(data.parentUid, "parent ID");
  const childId = requireString(data.childId, "child ID");

  const name = requireString(data.updates?.name, "name", 100);

  const username =
    typeof data.updates?.username === "string"
      ? data.updates.username.trim().replace(/^@/, "").slice(0, 40)
      : "";

  const parentRef = db.collection("users").doc(parentUid);
  const parentSnapshot = await parentRef.get();

  if (
    !parentSnapshot.exists ||
    parentSnapshot.data()?.accountType !== "parent"
  ) {
    throw new HttpsError(
      "not-found",
      "The parent account was not found."
    );
  }

  const childRef = parentRef.collection("kids").doc(childId);
  const childSnapshot = await childRef.get();

  if (!childSnapshot.exists) {
    throw new HttpsError(
      "not-found",
      "The parent-managed child profile was not found."
    );
  }

  const childData = childSnapshot.data();

  if (
    childData.parentUid &&
    childData.parentUid !== parentUid
  ) {
    throw new HttpsError(
      "permission-denied",
      "This child profile does not belong to the specified parent."
    );
  }

  await childRef.update({
    name,
    displayName: name,
    username,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: "Child profile updated successfully.",
  };
}

async function deleteAuthAccount(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    // Allow retries if the Auth account was already removed.
    if (error.code !== "auth/user-not-found") {
      throw error;
    }
  }
}

async function deleteAccount(data, callerUid) {
  const uid = requireString(data.uid, "user ID");
  const recordType = data.recordType;

  if (
    recordType !== "parent" &&
    recordType !== "independentChild"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Unsupported account type."
    );
  }

  await protectAdminAccount(uid, callerUid);

  const userRef = await getAccountDocument(uid, recordType);

  // Delete the Firebase Authentication account.
  await deleteAuthAccount(uid);

  // Recursively remove the user's Firestore document and all
  // nested subcollections, including child profiles and progress.
  try {
    await db.recursiveDelete(userRef);
  } catch (error) {
    console.error("Firestore recursive deletion failed:", error);

    throw new HttpsError(
      "internal",
      "The Authentication account was deleted, but Firestore cleanup failed. Retry the deletion to finish removing the remaining data."
    );
  }

  return {
    success: true,
    message: "Account and associated Firestore data deleted.",
  };
}

async function deleteManagedChild(data) {
  const parentUid = requireString(data.parentUid, "parent ID");
  const childId = requireString(data.childId, "child ID");

  const parentRef = db.collection("users").doc(parentUid);
  const parentSnapshot = await parentRef.get();

  if (
    !parentSnapshot.exists ||
    parentSnapshot.data()?.accountType !== "parent"
  ) {
    throw new HttpsError(
      "not-found",
      "The parent account was not found."
    );
  }

  const childRef = parentRef.collection("kids").doc(childId);
  const childSnapshot = await childRef.get();

  if (!childSnapshot.exists) {
    throw new HttpsError(
      "not-found",
      "The child profile was not found."
    );
  }

  const childData = childSnapshot.data();

  if (
    childData.parentUid &&
    childData.parentUid !== parentUid
  ) {
    throw new HttpsError(
      "permission-denied",
      "This child profile does not belong to the specified parent."
    );
  }

  // Remove the child profile and its nested progress/session data.
  await db.recursiveDelete(childRef);

  return {
    success: true,
    message: "Parent-managed child profile deleted.",
  };
}

exports.manageUserRecord = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    const callerUid = await verifyAdmin(request);
    const data = request.data || {};

    const action = data.action;
    const recordType = data.recordType;

    if (action === "update") {
      if (recordType === "parentManagedChild") {
        return updateManagedChild(data);
      }

      return updateAccount(data);
    }

    if (action === "delete") {
      if (recordType === "parentManagedChild") {
        return deleteManagedChild(data);
      }

      return deleteAccount(data, callerUid);
    }

    throw new HttpsError(
      "invalid-argument",
      "Unsupported action. Use update or delete."
    );
  }
);
