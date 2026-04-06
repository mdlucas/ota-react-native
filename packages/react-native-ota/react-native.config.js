module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import com.reactnativeota.NativeOtaPackage;',
        packageInstance: 'new NativeOtaPackage()',
      },
    },
  },
};
