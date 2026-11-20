<?php
// Run under PHP 7.4 and PHP 8.x with the JSON extension and assertions enabled.
// The false assertion below is intentional. Disable its exception and warning.
if ((int) ini_get('zend.assertions') !== 1 || !function_exists('json_decode') || PHP_INT_SIZE !== 8) {
    throw new RuntimeException('Requires 64-bit PHP with JSON and zend.assertions=1');
}
function check($got, $expected) {
    if ($got !== $expected) {
        throw new RuntimeException('Unexpected result: ' . var_export($got, true));
    }
}
$v8 = PHP_VERSION_ID >= 80000;
check(assert("1 === 2"), $v8);
check(0 == "apple", !$v8);
check(is_numeric("42 "), $v8);
check(is_numeric("42\u{A0}"), false);
check(strpos("abc","a"),0);
check(strpos("abc","z"),false);
check(json_decode("9223372036854775808",false,512,JSON_BIGINT_AS_STRING),"9223372036854775808");
check(is_float(json_decode("9223372036854775808")),true);
check(array_keys(["8"=>0,8=>1,"08"=>2,"+8"=>3]),[8,"08","+8"]);
$a=[10,20,30]; unset($a[1]); check(json_encode($a),'{"0":10,"2":30}');
check(array_search("7",[7,"7"],true),1);
check(array_search("7",[7,"7"]),0);
check(base64_decode("SGV!sbG8="),"Hello"); check(base64_decode("SGV!sbG8=",true),false);
check(urldecode("A+B%2BC"),"A B+C"); check(rawurldecode("A+B%2BC"),"A+B+C");
check(strlen(hash("sha256","a",true)),32); check(strlen(hash("sha256","a")),64);
check(strlen("A\0B"),3); check(strlen("\u{4E2D}"),3);
echo PHP_VERSION, " 12 cards passed\n";
