/**
 * FileService
 * Handles Google Drive file uploads for the HRMS system.
 */
var FileService = (function() {
  
  var FOLDER_NAME = 'AeroHRMS_Pictures';

  /**
   * Locates or creates the master folder for HRMS pictures.
   */
  function getFolder() {
    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(FOLDER_NAME);
  }

  /**
   * Uploads a Base64 image to Google Drive and returns the public URL.
   * @param {string} base64Data - The full data URL (e.g. data:image/jpeg;base64,/9j/4AAQSk...)
   * @param {string} filename - The name to save the file as.
   */
  function uploadImage(base64Data, filename) {
    if (!base64Data || !base64Data.startsWith('data:image/')) {
      throw new Error("Invalid image data provided.");
    }

    // Extract the mime type and the raw base64 string
    var splitData = base64Data.split(',');
    var mimeString = splitData[0].split(':')[1].split(';')[0];
    var rawBase64 = splitData[1];

    // Decode the base64 string into a Blob
    var decoded = Utilities.base64Decode(rawBase64);
    var blob = Utilities.newBlob(decoded, mimeString, filename);

    // Save to Drive
    var folder = getFolder();
    var file = folder.createFile(blob);

    // Set permissions so it can be viewed in the app
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Return the URL (WebViewLink is best for embedding/viewing)
    return file.getUrl();
  }

  return {
    uploadImage: uploadImage
  };

})();
