<?php
// Test users for local development. Each carries the SAML attributes
// passport-ubcshib is configured to request (see
// server/src/components/auth/strategies/shibboleth.ts):
//   uid, ubcEduCwlPuid, mail, eduPersonAffiliation, givenName, sn,
//   eduPersonPrincipalName.
// eduPersonAffiliation drives the role-appropriate home stub:
//   faculty -> instructor, student -> student, staff -> staff.
$config = [
    'admin' => ['core:AdminPassword'],
    'example-userpass' => [
        'exampleauth:UserPass',
        'student1:student1pass' => [
            'uid' => ['student1'],
            'ubcEduCwlPuid' => ['PUID-STUDENT-0001'],
            'mail' => ['student1@example.ubc.ca'],
            'eduPersonAffiliation' => ['student'],
            'givenName' => ['Sam'],
            'sn' => ['Student'],
            'eduPersonPrincipalName' => ['student1@ubc.ca'],
        ],
        'instructor1:instructor1pass' => [
            'uid' => ['instructor1'],
            'ubcEduCwlPuid' => ['PUID-INSTRUCTOR-0001'],
            'mail' => ['instructor1@example.ubc.ca'],
            'eduPersonAffiliation' => ['faculty'],
            'givenName' => ['Ida'],
            'sn' => ['Instructor'],
            'eduPersonPrincipalName' => ['instructor1@ubc.ca'],
        ],
        'ta1:ta1pass' => [
            'uid' => ['ta1'],
            'ubcEduCwlPuid' => ['PUID-TA-0001'],
            'mail' => ['ta1@example.ubc.ca'],
            'eduPersonAffiliation' => ['student', 'staff'],
            'givenName' => ['Tao'],
            'sn' => ['Assistant'],
            'eduPersonPrincipalName' => ['ta1@ubc.ca'],
        ],
        'admin1:admin1pass' => [
            'uid' => ['admin1'],
            'ubcEduCwlPuid' => ['PUID-ADMIN-0001'],
            'mail' => ['admin1@example.ubc.ca'],
            'eduPersonAffiliation' => ['staff'],
            'givenName' => ['Ada'],
            'sn' => ['Admin'],
            'eduPersonPrincipalName' => ['admin1@ubc.ca'],
        ],
    ],
];
