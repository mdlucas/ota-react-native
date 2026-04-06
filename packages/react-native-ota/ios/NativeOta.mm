#import "NativeOta.h"
#import "RNOtaSpec/RNOtaSpec.h"
#import <CommonCrypto/CommonDigest.h>

NSString *const RNOtaPendingBundlePathKey = @"pending_bundle_path";

static NSUserDefaults *RNOtaUserDefaults(void) {
  return [NSUserDefaults standardUserDefaults];
}

NSURL *_Nullable RtaPendingBundleFileURL(void) {
  NSString *path = [RNOtaUserDefaults() stringForKey:RNOtaPendingBundlePathKey];
  if (path.length == 0) {
    return nil;
  }
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    return nil;
  }
  return [NSURL fileURLWithPath:path];
}

@interface NativeOta : NativeOtaSpecBase <NativeOtaSpec>
@end

@implementation NativeOta

RCT_EXPORT_MODULE(RNOta)

- (void)downloadAndVerifyBundle:(NSString *)url
              expectedSha256Hex:(NSString *)expectedSha256Hex
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject
{
  if (url.length == 0) {
    reject(@"E_OTA_DOWNLOAD", @"empty url", nil);
    return;
  }
  NSURL *nsurl = [NSURL URLWithString:url];
  NSURLSession *session = [NSURLSession sharedSession];
  NSURLSessionDataTask *task = [session
      dataTaskWithURL:nsurl
      completionHandler:^(NSData *_Nullable data, NSURLResponse *_Nullable response, NSError *_Nullable error) {
        if (error != nil) {
          reject(@"E_OTA_DOWNLOAD", error.localizedDescription, error);
          return;
        }
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        if (http.statusCode < 200 || http.statusCode >= 300) {
          reject(@"E_OTA_DOWNLOAD", [NSString stringWithFormat:@"HTTP %ld", (long)http.statusCode], nil);
          return;
        }
        if (data == nil) {
          reject(@"E_OTA_DOWNLOAD", @"empty body", nil);
          return;
        }

        unsigned char digest[CC_SHA256_DIGEST_LENGTH];
        CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
        NSMutableString *actualHex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
        for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
          [actualHex appendFormat:@"%02x", digest[i]];
        }
        NSString *expected = [expectedSha256Hex lowercaseString];
        if (![[actualHex lowercaseString] isEqualToString:expected]) {
          reject(@"E_OTA_HASH", @"sha256 mismatch", nil);
          return;
        }

        NSError *ferror = nil;
        NSFileManager *fm = [NSFileManager defaultManager];
        NSURL *support = [fm URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
        NSURL *otaDir = [support URLByAppendingPathComponent:@"ota" isDirectory:YES];
        [fm createDirectoryAtURL:otaDir withIntermediateDirectories:YES attributes:nil error:&ferror];
        if (ferror != nil) {
          reject(@"E_OTA_IO", ferror.localizedDescription, ferror);
          return;
        }
        NSURL *outURL = [otaDir URLByAppendingPathComponent:@"pending.bundle"];
        if (![data writeToURL:outURL options:NSDataWritingAtomic error:&ferror]) {
          reject(@"E_OTA_IO", ferror.localizedDescription, ferror);
          return;
        }
        resolve(outURL.path);
      }];
  [task resume];
}

- (void)getPendingBundlePath:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSURL *url = RtaPendingBundleFileURL();
  resolve(url != nil ? url.path : @"");
}

- (void)setPendingBundlePath:(NSString *)path
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  [RNOtaUserDefaults() setObject:path forKey:RNOtaPendingBundlePathKey];
  [RNOtaUserDefaults() synchronize];
  resolve(nil);
}

- (void)clearPendingBundle:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [RNOtaUserDefaults() removeObjectForKey:RNOtaPendingBundlePathKey];
  [RNOtaUserDefaults() synchronize];
  resolve(nil);
}

- (void)restartApp:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(nil);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    exit(0);
  });
}

@end
